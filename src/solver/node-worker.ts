import { parentPort } from 'node:worker_threads';
import { handleRequest } from './worker.js';
parentPort?.on('message', request => parentPort!.postMessage(handleRequest(request)));
