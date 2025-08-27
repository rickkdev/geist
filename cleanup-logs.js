#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get all files with console logs
const consoleLogs = execSync(`grep -r "console\\." frontend/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -l --exclude-dir=node_modules`, { encoding: 'utf8' });

const files = consoleLogs.trim().split('\n').filter(file => file.trim());

console.log(`Found ${files.length} files with console logs:`);
files.forEach(file => console.log(`  - ${file}`));

// Remove console logs from each file
files.forEach(filePath => {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${filePath} - file not found`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;
  
  // Remove all console.log, console.error, console.warn, console.debug statements
  // This regex matches console.* calls including multiline ones
  newContent = newContent.replace(/console\.(log|error|warn|debug|info)\([^;]*\);?\s*/g, '');
  
  // Remove empty lines that were left after removing console statements
  newContent = newContent.replace(/^\s*\n/gm, '');
  
  // Remove multiple consecutive empty lines
  newContent = newContent.replace(/\n{3,}/g, '\n\n');
  
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent);
    console.log(`✅ Cleaned: ${filePath}`);
  } else {
    console.log(`⏭️ No changes: ${filePath}`);
  }
});

console.log('\n🧹 Console log cleanup complete!');