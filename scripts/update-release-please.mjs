#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { readFile, readdir, writeFile } from 'fs/promises';
import * as path from 'path';

const packagesDir = 'packages/';

const rootUrl = new URL('..', import.meta.url);
const root = fileURLToPath(rootUrl);

const releasePleaseManifestUrl = new URL('.release-please-manifest.json', rootUrl);
const releasePleaseConfigUrl = new URL('release-please-config.json', rootUrl);

run();

async function collectPackages() {
    const packagesUrl = new URL(packagesDir, rootUrl);
    const entries = await readdir(packagesUrl, { withFileTypes: true });
    const packageDirs = entries.filter((dir) => dir.isDirectory());
    const packages = packageDirs.map(({ name }) => ({ dirName: name, path: packagesDir + name }));

    for (const pkg of packages) {
        const packageUrl = new URL(pkg.path + '/package.json', rootUrl);
        const packageJson = await readJson(packageUrl);
        pkg.version = packageJson.version;
        pkg.name = packageJson.name;
    }

    packages.sort((a, b) => (a.path < b.path ? -1 : 1));

    return packages;
}

async function updateManifest(packages) {
    const manifest = await readJson(releasePleaseManifestUrl);

    for (const pkg of packages) {
        manifest[pkg.path] = pkg.version;
    }

    await writeJson(releasePleaseManifestUrl, manifest);
}

async function updateConfig(packages) {
    const config = await readJson(releasePleaseConfigUrl);

    config.packages = config.packages ?? {};

    // Update packages
    for (const pkg of packages) {
        config.packages[pkg.path] = {
            component: pkg.name,
            releaseType: 'node',
        };
    }

    // Update linked packages
    const linkedVersions = config.plugins.find((plug) => plug.type === 'linked-versions');
    linkedVersions.components = packages.map((pkg) => pkg.name);

    await writeJson(releasePleaseConfigUrl, config);
}

async function readJson(filename) {
    const content = await readFile(filename, { encoding: 'utf8' });
    return JSON.parse(content);
}

async function writeJson(filename, data) {
    const content = JSON.stringify(data, null, 4);
    await writeFile(filename, content, { encoding: 'utf8' });
}

async function run() {
    console.log('Update Release Please Manifest and Configuration');
    const packages = await collectPackages();
    await updateManifest(packages);
    await updateConfig(packages);
    console.log('Done.');
}
