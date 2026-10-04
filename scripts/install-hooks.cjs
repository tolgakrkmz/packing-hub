const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
for(const hook of ['pre-commit','pre-push']) fs.chmodSync(path.join(root,'.githooks',hook),0o755);
execFileSync('git',['config','core.hooksPath','.githooks'],{cwd:root});
console.log('Publication checks enabled for commits and pushes.');
