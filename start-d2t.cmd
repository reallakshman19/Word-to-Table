@echo off
REM ═══ Doc2Table Prototype Launcher ═══
REM Serves the prototype on a local HTTP server and opens it in the browser.
REM Usage: start-d2t.cmd
REM
REM Requirements: Node.js (for the HTTP server)

setlocal
set PORT=8091
set DIR=%~dp0prototype

echo.
echo  Doc2Table D2T-S1 Prototype
echo  ──────────────────────────
echo  Serving: %DIR%
echo  URL:     http://localhost:%PORT%/
echo.

REM Check if port is in use and try next ports
netstat -an | findstr ":%PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    set /a PORT=%PORT%+1
    echo Port %PORT% in use, trying %PORT%...
)

REM Start Node.js HTTP server and open browser
node -e "const http=require('http'),fs=require('fs'),path=require('path'),url=require('url'),cp=require('child_process');const MIME={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};const ROOT=process.argv[1];const PORT=parseInt(process.argv[2]);http.createServer((req,res)=>{let p=url.parse(req.url).pathname;if(p==='/')p='/index.html';const fp=path.join(ROOT,p);const ext=path.extname(fp);fs.readFile(fp,(err,data)=>{if(err){res.writeHead(404);res.end('Not found: '+p);return;}res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);});}).listen(PORT,()=>{const target='http://localhost:'+PORT+'/';console.log('Server running at '+target);console.log('Opening browser...');cp.exec('start \"\" \"'+target+'\"');console.log('Press Ctrl+C to stop server.');});" "%DIR%" %PORT%

REM The node process blocks, so this line runs after Ctrl+C
echo Server stopped.
