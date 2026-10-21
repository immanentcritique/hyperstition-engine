#!/usr/bin/env node
// recursion kernel — run `node kernel.mjs help`
import { main } from './kernel/cli.mjs';
import { KernelError } from './kernel/format.mjs';

main(process.argv.slice(2)).catch((e) => {
  if (e instanceof KernelError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
});
