// Run unchanged private regression sources with the original module resolution.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

module.exports = function runPrivateFixture(filename) {
    const directory = process.env.D2T_PRIVATE_TEST_DIR;
    if (!directory) {
        console.log('SKIP original-document regression: set D2T_PRIVATE_TEST_DIR to the local fixture bundle.');
        return;
    }
    const source = path.join(directory, path.basename(filename));
    if (!fs.existsSync(source)) throw new Error('Missing private regression source: ' + source);
    const runner = new Module(filename, module);
    runner.filename = filename;
    runner.paths = Module._nodeModulePaths(path.dirname(filename));
    runner._compile(fs.readFileSync(source, 'utf8'), filename);
};
