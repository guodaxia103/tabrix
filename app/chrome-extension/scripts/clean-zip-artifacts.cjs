const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(__dirname, '..', '.output');

function isZipArtifact(fileName) {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.zip')) return false;
  return (
    lower.endsWith('-chrome.zip') ||
    lower.endsWith('-firefox.zip') ||
    lower.includes('chrome-mcp-server') ||
    lower.includes('tabrix-extension') ||
    lower.includes('lastest')
  );
}

try {
  if (!fs.existsSync(outputDir)) {
    process.exit(0);
  }

  const files = fs.readdirSync(outputDir);
  for (const file of files) {
    if (!isZipArtifact(file)) continue;
    const fullPath = path.join(outputDir, file);
    if (fs.statSync(fullPath).isFile()) {
      fs.rmSync(fullPath, { force: true });
      console.log(`[tabrix] Removed stale zip artifact: ${file}`);
    }
  }
} catch (error) {
  console.warn(`[tabrix] Failed to clean zip artifacts: ${error.message}`);
}
