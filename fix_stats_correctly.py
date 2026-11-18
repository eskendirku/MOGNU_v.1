
file_path = r"c:\Users\user\Desktop\GEM_phd\новый обработчик\src\stats.ts"
# ... (This will be too long to write in one go. I'll read it back or just use the parts I know.)
# I have the file already, I just need to fix the end.
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Reconstruct:
# Find index of "export const generateKinematicsCSV"
idx = 0
for i, line in enumerate(lines):
    if "export const generateKinematicsCSV" in line:
        idx = i
        break

# Insert missing lines before idx
missing = [
    "    return values.map(escapeCSV);",
    "  });",
    "",
    "  return [headers.join(','), ...subjectRows.map(r => r.join(','))].join('\\n');",
    "};",
    ""
]

new_lines = lines[:idx] + missing + lines[idx:]
with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)
