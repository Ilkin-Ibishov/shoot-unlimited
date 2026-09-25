'use strict';
// Renders sounds and music off the main thread (see js/dsp.js); buffers are transferred, not copied.
importScripts('dsp.js');
onmessage = e => { const { res, tr } = DSP.job(e.data); res.id = e.data.id; postMessage(res, tr); };
