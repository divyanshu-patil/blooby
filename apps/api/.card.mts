import { writeFileSync } from 'node:fs';
import { ogService } from './src/services/og.service.js';
writeFileSync('/tmp/og-long.png', ogService.generic('A really quite long project name that keeps going', 'Made with blooby'));
writeFileSync('/tmp/og-generic.png', ogService.generic());
console.log('ok');
