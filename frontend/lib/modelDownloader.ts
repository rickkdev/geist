import RNFS from 'react-native-fs';

const MODEL_URL = 'http://127.0.0.1:3000/DeepSeek-R1-Distill-Qwen-7B-IQ2_M.gguf';
const MODEL_FILENAME = 'DeepSeek-R1-Distill-Qwen-7B-IQ2_M.gguf';

export async function downloadModel(onProgress?: (progress: number) => void): Promise<string> {
  const modelPath = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;

  // Check if model already exists
  const exists = await RNFS.exists(modelPath);
  if (exists) {
    return modelPath;
  }


  try {
    const downloadResult = await RNFS.downloadFile({
      fromUrl: MODEL_URL,
      toFile: modelPath,
      progress: onProgress
        ? (res) => {
            const progress = (res.bytesWritten / res.contentLength) * 100;
            onProgress(progress);
          }
        : undefined,
    }).promise;

    if (downloadResult.statusCode === 200) {
      return modelPath;
    } else {
      throw new Error(`Download failed with status: ${downloadResult.statusCode}`);
    }
  } catch (error) {
    throw error;
  }
}

export async function getModelPath(): Promise<string | null> {
  const modelPath = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;
  const exists = await RNFS.exists(modelPath);
  return exists ? modelPath : null;
}

export async function deleteModel(): Promise<void> {
  const modelPath = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;
  const exists = await RNFS.exists(modelPath);
  if (exists) {
    await RNFS.unlink(modelPath);
  }
}
