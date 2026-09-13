import { execFileSync } from 'node:child_process';
const files = execFileSync('gofmt', ['-l', 'cmd', 'internal'], {
  encoding: 'utf8',
}).trim();
if (files) {
  console.error('Run npm run format. Unformatted Go files:\n' + files);
  process.exitCode = 1;
}
