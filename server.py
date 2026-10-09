"""
Local web server for Word Table Extractor.
Uses Python's built-in http.server - no Flask needed.
Handles file uploads and table extraction server-side.
"""
import http.server
import json
import os
import sys
import io
import cgi
import tempfile
import traceback
import webbrowser
from urllib.parse import urlparse

import tkinter
import tkinter.filedialog

# Add scripts directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scripts'))

from scripts import word_to_table
from scripts import smart_table_extractor
from scripts import row_splitter # New module
import pandas as pd

PORT = 8000


class ExtractorHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler that processes file uploads for table extraction."""

    def do_HEAD(self):
        """Handle HEAD requests — used by frontend for mode detection."""
        parsed = urlparse(self.path)
        if parsed.path == '/extract':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
        else:
            super().do_HEAD()

    def do_GET(self):
        """Handle GET requests."""
        parsed = urlparse(self.path)
        if parsed.path == '/select_folder':
            self._handle_select_folder()
        else:
            super().do_GET()

    def do_POST(self):
        """Handle POST requests for file upload and extraction."""
        parsed = urlparse(self.path)

        if parsed.path == '/extract':
            self._handle_extract()
        elif parsed.path == '/export_batch':
            self._handle_export_batch()
        else:
            self.send_error(404, "Not Found")

    def _handle_extract(self):
        """Process uploaded .docx file and extract tables."""
        try:
            # Parse multipart form data
            content_type = self.headers.get('Content-Type', '')
            if 'multipart/form-data' not in content_type:
                self._send_json(400, {"error": "Expected multipart/form-data"})
                return

            # Parse the form data
            boundary = content_type.split('boundary=')[1].encode()
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            # Extract file and mode from multipart data
            file_data, filename, mode, robust_flag = self._parse_multipart(body, boundary)

            if not file_data:
                self._send_json(400, {"error": "No file uploaded"})
                return

            if not filename.lower().endswith('.docx'):
                self._send_json(400, {"error": "Only .docx files are supported. Please convert .doc files to .docx format."})
                return

            # Save to temp file
            tmp_path = os.path.join(tempfile.gettempdir(), 'upload.docx')
            with open(tmp_path, 'wb') as f:
                f.write(file_data)

            results = []
            logs = []
            stray_text = []
            total_pages = 1

            # STANDARD MODE
            if mode in ["Standard", "Both"]:
                logs.append(f"Running Standard Extraction (Rules)... Robust Mode: {robust_flag}")
                try:
                    data_store = word_to_table.parse_docx(tmp_path, robust_mode=robust_flag)
                    for key, dfs in data_store.items():
                        for i, df in enumerate(dfs):
                            results.append({
                                "html": df.to_html(index=False, classes="result-table"),
                                "csv": df.to_csv(index=False),
                                "rows": len(df),
                                "cols": len(df.columns),
                                "source": "Standard",
                                "type": str(key),
                                "confidence": "Rule-Based"
                            })
                    logs.append(f"Standard: Found {sum(len(dfs) for dfs in data_store.values())} tables")
                except Exception as e:
                    logs.append(f"Standard Extraction Error: {str(e)}")

            # SMART MODE
            if mode in ["Smart", "Both"]:
                logs.append("Running Smart Extraction (Heuristic)...")
                try:
                    extractor = smart_table_extractor.SmartTableExtractor(tmp_path, robust_mode=robust_flag)
                    extraction_result = extractor.extract_all_with_pages()

                    for i, res in enumerate(extraction_result["tables"]):
                        df = res['df']
                        meta = res['meta']
                        
                        # --- POST-PROCESSING: Split Multi-line Rows ---
                        # MOVED TO SmartTableExtractor internal logic
                        # -----------------------------------------------

                        results.append({
                            "html": df.to_html(index=False, classes="result-table"),
                            "csv": df.to_csv(index=False),
                            "rows": len(df),
                            "cols": len(df.columns),
                            "headers": list(df.columns),
                            "dataRows": df.values.tolist(),
                            "source": "Smart",
                            "type": "Heuristic",
                            "confidence": str(meta.get('confidence', 'low')),
                            "pageNumber": meta.get('page_number', 1),
                            "tableName": meta.get('table_name', ''),
                            "tableIndex": meta.get('table_index', 0),
                        })
                        
                        # Log if Robust Parsing was used
                        # DEBUG: Log all metadata keys
                        # logs.append(f"DEBUG: Meta keys for Table {meta.get('table_index')}: {list(meta.keys())} | technique={meta.get('technique')}")

                        if meta.get('technique') == 'RobustGrid':
                            logs.append(f"Table {meta.get('table_index', 0)}: Used Robust Parsing (Grid-based)")

                    stray_text = extraction_result.get("stray_text", [])
                    total_pages = extraction_result.get("total_pages", 1)
                    
                    # Add Summary Log
                    logs.append(f"Smart Extraction Complete: Found {len(extraction_result['tables'])} tables across {total_pages} pages.")
                    
                    # Detailed Logs per Table
                    for i, res in enumerate(extraction_result["tables"]):
                        df_log = res['df']
                        meta_log = res['meta']
                        row_count = len(df_log)
                        col_count = len(df_log.columns)
                        tech = meta_log.get('technique', 'Unknown')
                        conf = meta_log.get('confidence', 'low')
                        t_idx = meta_log.get('table_index', i)
                        page = meta_log.get('page_number', '?')
                        
                        logs.append(f"[Table #{t_idx + 1}] Page {page}: Extracted {row_count}x{col_count} (Technique: {tech}, Confidence: {conf})")
                        if 'debug_sample' in meta_log:
                            logs.append(f"  - Content Preview (Raw): {meta_log['debug_sample']}")
                        if 'errors' in meta_log and meta_log['errors']:
                            logs.append(f"  - Warnings: {meta_log['errors']}")
                except Exception as e:
                    logs.append(f"Smart Extraction Error: {str(e)}")
                    traceback.print_exc()

            # Cleanup
            try:
                os.remove(tmp_path)
            except:
                pass

            logs.append(f"Processing complete. Total tables found: {len(results)}")

            self._send_json(200, {
                "success": True,
                "tables": results,
                "strayText": stray_text,
                "totalPages": total_pages,
                "logs": logs,
                "filename": filename
            })

        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {"error": str(e), "traceback": traceback.format_exc()})

    def _parse_multipart(self, body, boundary):
        """Parse multipart form data to extract file and mode."""
        file_data = None
        filename = ""
        mode = "Smart"
        robust_flag = False

        parts = body.split(b'--' + boundary)
        for part in parts:
            if b'Content-Disposition' not in part:
                continue

            header_end = part.find(b'\r\n\r\n')
            if header_end == -1:
                continue

            header = part[:header_end].decode('utf-8', errors='replace')
            content = part[header_end + 4:]

            # Remove trailing \r\n--
            if content.endswith(b'\r\n'):
                content = content[:-2]

            if 'name="file"' in header:
                # Extract filename
                if 'filename="' in header:
                    fn_start = header.index('filename="') + 10
                    fn_end = header.index('"', fn_start)
                    filename = header[fn_start:fn_end]
                file_data = content
            elif 'name="mode"' in header:
                mode = content.decode('utf-8').strip()
            elif 'name="robust"' in header:
                val = content.decode('utf-8').strip().lower()
                robust_flag = (val == 'true')

        return file_data, filename, mode, robust_flag

    def _send_json(self, status_code, data):
        """Send a JSON response."""
        response = json.dumps(data, ensure_ascii=False)
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response.encode('utf-8'))))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(response.encode('utf-8'))

    def _handle_select_folder(self):
        """Open a system folder picker dialog."""
        try:
            root = tkinter.Tk()
            root.withdraw() # Hide main window
            root.attributes('-topmost', True) # Bring to front
            folder_path = tkinter.filedialog.askdirectory(title="Select Export Directory")
            root.destroy()
            
            self._send_json(200, {"path": folder_path})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_export_batch(self):
        """Handle batch export of tables."""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            target_path = data.get('path')
            mode = data.get('mode') # 'individual' or 'combined'
            include_log = data.get('include_log', True)
            table_indices = set(data.get('tables', []))

            if not target_path or not os.path.exists(target_path):
                self._send_json(400, {"error": "Invalid target path"})
                return

            # Note: In a real app, we'd need the table data here.
            # Since we don't persist state on the server between requests (stateless),
            # we typically would need the client to send the table data OR
            # we rely on the client sending the CSV content.
            # However, looking at the previous implementation, the server re-extracts every time?
            # No, `extract_all_with_pages` returns data.
            # Wait, the current architecture is that the Client has the state (appState).
            # The server doesn't know about 'appState.tables'.
            # SO, the client must send the Table Data (CSV/HTML) to the server for saving,
            # OR the client saves it using the File System Access API (Browser mode),
            # OR we implement a "save_file" endpoint where client sends content.
            
            # The previous logic for `export_batch` implies the server does it.
            # But the server doesn't have the tables unless we passed them in the JSON.
            # Let's check `output_tab.js`. It sends `tables: indices`.
            # PROB: Server doesn't have the table content!
            # FIX: output_tab.js should generate the content and send it, OR 
            # the server needs to re-extract (bad), OR we assume the server kept state (it didn't).
            
            # Correction: The prompt implies I should implement the server logic.
            # But without data, I can't.
            # I will modify `output_tab.js` to send the DATA (headers + rows) or CSV content
            # in the payload, OR I will make this endpoint a "Save Many Files" endpoint.
            
            # Given the request size limits, sending all data might be heavy but acceptable for this scale.
            # I will assume `output_tab.js` will be updated to send `tables: [{name, csv, ...}]`.
            # I need to update `output_tab.js` next.
            # For now, I will write the server logic assuming `data['tables']` contains the table objects,
            # NOT just indices.
            
            count = 0
            
            # Clean path
            target_path = os.path.normpath(target_path)

            if mode == 'individual':
                for t in data.get('tableObjects', []): # Expecting full objects
                    safe_name = "".join([c for c in t.get('tableName', 'Table') if c.isalpha() or c.isdigit() or c==' ' or c=='_']).strip()
                    safe_name = safe_name.replace(" ", "_")
                    fname = f"{safe_name}.csv"
                    fpath = os.path.join(target_path, fname)
                    
                    # CSV Content
                    csv_content = t.get('csv', '')
                    if not csv_content:
                        # Reconstruct if missing (should be sent by client)
                        pass
                    
                    with open(fpath, 'w', encoding='utf-8-sig') as f:
                        f.write(csv_content)
                    count += 1
                
                if include_log:
                    log_path = os.path.join(target_path, "Extraction_Log.txt")
                    with open(log_path, 'w', encoding='utf-8') as f:
                        f.write(f"Export Log - {len(data.get('tableObjects', []))} tables exported.\n")
                        # Client should send logs too if needed
            
            elif mode == 'combined':
                # Need pandas
                excel_path = os.path.join(target_path, "Combined_Tables.xlsx")
                with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
                    for t in data.get('tableObjects', []):
                        # Convert CSV string back to DF? Or list of lists?
                        # Client sending 'dataRows' and 'headers' is better.
                        headers = t.get('headers', [])
                        rows = t.get('dataRows', [])
                        safe_name = "".join([c for c in t.get('tableName', 'Table') if c.isalpha() or c.isdigit() or c==' ' or c=='_']).strip()
                        safe_name = safe_name[:30] # Excel sheet limit
                        
                        df = pd.DataFrame(rows, columns=headers)
                        df.to_excel(writer, sheet_name=safe_name, index=False)
                        count += 1
                    
                    if include_log:
                        # Add log sheet
                        pd.DataFrame(["Log entry placeholder"]).to_excel(writer, sheet_name="Processing_Log", index=False)

            self._send_json(200, {"success": True, "count": count})

        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {"error": str(e)})

    def log_message(self, format, *args):
        """Override to show cleaner log messages."""
        print(f"[Server] {args[0]}")


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('', PORT), ExtractorHandler)
    print(f"=" * 50)
    print(f"  Word Table Extractor - Web Server")
    print(f"  Running at http://localhost:{PORT}")
    print(f"  Open http://localhost:{PORT}/index.html")
    print(f"=" * 50)

    # Auto-open browser
    webbrowser.open(f'http://localhost:{PORT}/index.html')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == '__main__':
    main()
