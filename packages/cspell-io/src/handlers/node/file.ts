import type { ServiceBus } from '@cspell/cspell-service-bus';
import {
    createResponse,
    createResponseFail,
    isServiceResponseFailure,
    isServiceResponseSuccess,
} from '@cspell/cspell-service-bus';
import assert from 'assert';
import { promises as fs, readFileSync, statSync } from 'fs';
import type { URL } from 'url';
import { fileURLToPath } from 'url';
import { gunzipSync, gzipSync } from 'zlib';

import { arrayBufferViewToBuffer } from '../../common/arrayBuffers.js';
import { decode } from '../../common/encode-decode.js';
import { toError } from '../../errors/index.js';
import type { BufferEncoding } from '../../models/BufferEncoding.ts';
import { decodeDataUrl } from '../../node/dataUrl.js';
import { fetchURL } from '../../node/file/fetch.js';
import { getStatHttp } from '../../node/file/stat.js';
import {
    RequestFsReadBinaryFile,
    RequestFsReadBinaryFileSync,
    RequestFsReadFile,
    RequestFsReadFileSync,
    RequestFsStat,
    RequestFsStatSync,
    RequestFsWriteFile,
    RequestZlibInflate,
} from '../../requests/index.js';

const isGzFileRegExp = /\.gz($|[?#])/;

function isGzFile(url: URL): boolean {
    return isGzFileRegExp.test(url.pathname);
}

/*
 * NOTE: fileURLToPath is used because of yarn bug https://github.com/yarnpkg/berry/issues/899
 */

/**
 * Handle Binary File Reads
 */
const handleRequestFsReadBinaryFile = RequestFsReadBinaryFile.createRequestHandler(
    ({ params }) =>
        createResponse(fs.readFile(fileURLToPath(params.url)).then((content) => ({ url: params.url, content }))),
    undefined,
    'Node: Read Binary File.',
);

/**
 * Handle Binary File Sync Reads
 */
const handleRequestFsReadBinaryFileSync = RequestFsReadBinaryFileSync.createRequestHandler(
    ({ params }) => createResponse({ url: params.url, content: readFileSync(fileURLToPath(params.url)) }),
    undefined,
    'Node: Sync Read Binary File.',
);

/**
 * Handle UTF-8 Text File Reads
 */
const handleRequestFsReadFile = RequestFsReadFile.createRequestHandler(
    (req, _, dispatcher) => {
        const { url, encoding } = req.params;
        const res = dispatcher.dispatch(RequestFsReadBinaryFile.create({ url }));
        if (!isServiceResponseSuccess(res)) {
            assert(isServiceResponseFailure(res));
            return createResponseFail(req, res.error);
        }
        return createResponse(
            res.value.then((res) => {
                const content = bufferToText(res.content, encoding);
                return {
                    url,
                    baseFilename: res.baseFilename,
                    encoding,
                    ...content,
                };
            }),
        );
    },
    undefined,
    'Node: Read Text File.',
);

/**
 * Handle UTF-8 Text File Reads
 */
const handleRequestFsReadFileSync = RequestFsReadFileSync.createRequestHandler(
    (req, _, dispatcher) => {
        const { url, encoding } = req.params;
        const res = dispatcher.dispatch(RequestFsReadBinaryFileSync.create({ url }));
        if (!isServiceResponseSuccess(res)) {
            assert(isServiceResponseFailure(res));
            return createResponseFail(req, res.error);
        }
        return createResponse({
            encoding,
            ...res.value,
            ...bufferToText(res.value.content, encoding),
        });
    },
    undefined,
    'Node: Sync Read Text File.',
);

/**
 * Handle deflating gzip data
 */
const handleRequestZlibInflate = RequestZlibInflate.createRequestHandler(
    ({ params }) => createResponse(gunzipSync(params.data).toString('utf-8')),
    undefined,
    'Node: gz deflate.',
);

const supportedFetchProtocols: Record<string, true | undefined> = { 'http:': true, 'https:': true };

/**
 * Handle fetching a file from http
 */
const handleRequestFsReadBinaryFileHttp = RequestFsReadBinaryFile.createRequestHandler(
    (req: RequestFsReadBinaryFile, next) => {
        const { url } = req.params;
        if (!(url.protocol in supportedFetchProtocols)) return next(req);
        return createResponse(fetchURL(url).then((content) => ({ url, content })));
    },
    undefined,
    'Node: Read Http(s) file.',
);

/**
 * Handle decoding a data url
 */
const handleRequestFsReadBinaryFileSyncData = RequestFsReadBinaryFileSync.createRequestHandler(
    (req: RequestFsReadBinaryFileSync, next) => {
        const { url } = req.params;
        if (url.protocol !== 'data:') return next(req);
        const data = decodeDataUrl(url);
        return createResponse({ url, content: data.data, baseFilename: data.attributes.get('filename') });
    },
    undefined,
    'Node: Read data: urls.',
);

/**
 * Handle decoding a data url
 */
const handleRequestFsReadBinaryFileData = RequestFsReadBinaryFile.createRequestHandler(
    (req: RequestFsReadBinaryFile, next, dispatcher) => {
        const { url } = req.params;
        if (url.protocol !== 'data:') return next(req);
        const res = dispatcher.dispatch(RequestFsReadBinaryFileSync.create(req.params));
        if (!isServiceResponseSuccess(res)) return res;
        return createResponse(Promise.resolve(res.value));
    },
    undefined,
    'Node: Read data: urls.',
);

function bufferToText(data: ArrayBufferView, encoding: BufferEncoding): { content: string; gz: boolean } {
    const buf = arrayBufferViewToBuffer(data);
    const gz = buf[0] === 0x1f && buf[1] === 0x8b;
    const content = gz ? decode(gunzipSync(buf), encoding) : decode(buf, encoding);
    return { content, gz };
}

/**
 * Handle fs:stat
 */
const handleRequestFsStat = RequestFsStat.createRequestHandler(
    ({ params }) => createResponse(fs.stat(fileURLToPath(params.url))),
    undefined,
    'Node: fs.stat.',
);

/**
 * Handle fs:statSync
 */
const handleRequestFsStatSync = RequestFsStatSync.createRequestHandler(
    (req) => {
        const { params } = req;
        try {
            return createResponse(statSync(fileURLToPath(params.url)));
        } catch (e) {
            return createResponseFail(req, toError(e));
        }
    },
    undefined,
    'Node: fs.stat.',
);

/**
 * Handle deflating gzip data
 */
const handleRequestFsStatHttp = RequestFsStat.createRequestHandler(
    (req, next) => {
        const { url } = req.params;
        if (!(url.protocol in supportedFetchProtocols)) return next(req);
        return createResponse(getStatHttp(url));
    },
    undefined,
    'Node: http get stat',
);

/**
 * Handle fs:writeFile
 */
const handleRequestFsWriteFile = RequestFsWriteFile.createRequestHandler(
    ({ params }) => createResponse(fs.writeFile(params.url, params.content)),
    undefined,
    'Node: fs.writeFile',
);

/**
 * Handle fs:writeFile compressed
 */
const handleRequestFsWriteFileGz = RequestFsWriteFile.createRequestHandler(
    (req, next) => {
        const { url, content } = req.params;
        if (!isGzFile(url)) return next(req);
        return createResponse(fs.writeFile(url, gzipSync(content)));
    },
    undefined,
    'Node: http get stat',
);

export function registerHandlers(serviceBus: ServiceBus) {
    /**
     * Handlers are in order of low to high level
     * Order is VERY important.
     */
    const handlers = [
        handleRequestFsWriteFile,
        handleRequestFsWriteFileGz,
        handleRequestFsReadBinaryFile,
        handleRequestFsReadBinaryFileSync,
        handleRequestFsReadBinaryFileHttp,
        handleRequestFsReadBinaryFileData,
        handleRequestFsReadBinaryFileSyncData,
        handleRequestFsReadFile,
        handleRequestFsReadFileSync,
        handleRequestZlibInflate,
        handleRequestFsStatSync,
        handleRequestFsStat,
        handleRequestFsStatHttp,
    ];

    handlers.forEach((handler) => serviceBus.addHandler(handler));
}
