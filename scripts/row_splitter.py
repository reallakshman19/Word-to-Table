import logging
import re

logger = logging.getLogger(__name__)

def split_rows_raw(rows_data):
    """
    Splits multi-line rows in a list of lists of strings.
    Pre-processes data before DataFrame creation.
    """
    if not rows_data:
        return rows_data

    # Heuristic Check
    max_newlines = 0
    total_rows = len(rows_data)
    
    for row in rows_data:
        for val in row:
            n_newlines = len(re.findall(r'[\r\n\v\f]', str(val)))
            max_newlines = max(max_newlines, n_newlines)

    logger.debug(f"RowSplitter Check - Rows: {total_rows}, Max Newlines: {max_newlines}")

    if total_rows >= 10 or max_newlines < 3:
        return rows_data, False # Skip

    logger.info(f"RowSplitter Triggered! Splitting table with {total_rows} rows.")
    
    new_rows = []
    
    for row in rows_data:
        # ... (splitting logic same as before) ...
        # Determine splits
        row_splits = 1
        cell_splits = []
        
        for val in row:
            val_str = str(val)
            lines = re.split(r'[\r\n\v\f]+', val_str)
            lines = [line.strip() for line in lines if line.strip()]
            if not lines:
                lines = [""]
            
            cell_splits.append(lines)
            row_splits = max(row_splits, len(lines))
        
        if row_splits > 1:
             for i in range(row_splits):
                new_row_data = []
                for lines in cell_splits:
                    if i < len(lines):
                        new_row_data.append(lines[i])
                    else:
                        new_row_data.append("")
                new_rows.append(new_row_data)
        else:
            new_rows.append(row)
            
    # Post-split optimization: Drop duplicate columns
    # Often merged cells result in identical columns in the raw grid.
    if new_rows and len(new_rows) > 1:
        num_cols = len(new_rows[0])
        cols_to_drop = set()
        
        # Compare columns pairwise
        for c1 in range(num_cols):
            for c2 in range(c1 + 1, num_cols):
                if c2 in cols_to_drop: continue
                
                # Check if col c1 and c2 are identical across all rows
                # Heuristic: Drop c2 if it matches c1 OR if c2 is empty (artifact of normalization/merging)
                can_drop = True
                for r_idx, r in enumerate(new_rows):
                    val1 = r[c1]
                    val2 = r[c2]
                    
                    # If they are equal, it's fine.
                    # If val2 is empty, we consider it "mergeable" into val1 (or just ignorable duplicate artifact)
                    if val1 == val2:
                        continue
                    
                    if str(val2).strip() == "":
                        # val2 is empty, val1 is not. 
                        # Assume val2 is just a normalized empty cell from a merge.
                        continue
                        
                    # If we get here, val2 has real data and is different from val1.
                    can_drop = False
                    # logger.debug(f"Dedup failed Row {r_idx}: '{val1}' vs '{val2}'")
                    break
                
                if can_drop:
                    cols_to_drop.add(c2)
        
        if cols_to_drop:
            logger.info(f"Dropping detected duplicate columns: {cols_to_drop}")
            final_rows = []
            for r in new_rows:
                new_r = [val for idx, val in enumerate(r) if idx not in cols_to_drop]
                final_rows.append(new_r)
            return final_rows, True

    return new_rows, True

def add_auto_numbering(df):
    """
    Adds a 'No.' column if the first column isn't already a sequence.
    """
    if df.empty:
        return df
        
    # Check first column for sequential integers
    is_numbered = False
    try:
        if df.shape[1] > 0:
            first_col = df.iloc[:, 0].astype(str).str.replace('.', '', regex=False)
            # Check if they look like digits or common numbering "1", "1.", "(1)"
            # Simple check: are they all numeric?
            if first_col.str.isnumeric().all():
                 is_numbered = True
    except:
        pass

    if not is_numbered:
        # Insert "No." column at index 0 (1-based)
        # Use simple range
        df.insert(0, 'No.', range(1, len(df) + 1))
        
    return df 

