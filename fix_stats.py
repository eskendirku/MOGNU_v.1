
file_path = r"c:\Users\user\Desktop\GEM_phd\новый обработчик\src\stats.ts"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# I know what the end of the generateStatsCSV should look like.
# Find the line "const subjectRows = filteredSubjects.map(s => {"
# Find the next "export const generateKinematicsCSV"
# Insert "    return values.map(escapeCSV); }); return [headers.join(','), ...subjectRows.map(r => r.join(','))].join('\n'); };" before it.

start_marker = "const subjectRows = filteredSubjects.map(s => {"
end_marker = "export const generateKinematicsCSV"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

# Need to find the end of the subjectRows map and the function body
# This is hard. I'll just restore from a known good state or fix manually.

# Re-doing the generation of the file is safer.
print("File broken. Manual fix required or full overwrite with correct logic.")
