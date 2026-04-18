import { pipeline, env } from '@huggingface/transformers';

// Disable saving to local storage cache to avoid some browser quota limits for large models
// It will still utilize HTTP caching.
env.allowLocalModels = false;

let transcriber: any = null;

self.onmessage = async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case 'load':
      try {
        self.postMessage({ status: 'loading', message: 'Loading Whispering model...' });
        
        // Load the model
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          progress_callback: (info: any) => {
            self.postMessage({ status: 'progress', info });
          }
        });

        self.postMessage({ status: 'ready' });
      } catch (err: any) {
        self.postMessage({ status: 'error', message: err.message });
      }
      break;

    case 'transcribe':
      try {
        if (!transcriber) throw new Error('Model is not initialized.');

        self.postMessage({ status: 'transcribing' });
        
        // Run inference
        const output = await transcriber(data.audio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: true,
        });

        self.postMessage({ status: 'complete', result: output });
      } catch (err: any) {
        self.postMessage({ status: 'error', message: err.message });
      }
      break;
  }
};
