/* misc/_llm/worker.js
 *
 * The model inside a Web Worker. client.js starts this file and talks to it;
 * a page never loads it with a script tag.
 *
 * All the work is done by LLM.host() in llm.js, which answers requests of the
 * form { id, cmd, args } (the list is in the README). This file only connects
 * that handler to the worker's messages. The first request is "load", carrying
 * the two weight files as ArrayBuffers: the worker fetches nothing itself.
 */
/* global importScripts, LLM */
'use strict';

importScripts('llm.js');

var host = LLM.host();

self.onmessage = function (event) {
	host.handle(event.data, function (reply, transfer) {
		self.postMessage(reply, transfer || []);
	});
};
