import axios from 'axios';
import { join } from 'path';
import { promises as fs, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { CancellationToken, Uri } from 'vscode';
import StreamZip = require('node-stream-zip');

export async function downloadFile(
    uri: Uri,
    extract: boolean,
    token: CancellationToken,
    callback: (downloaded: number, total?: number) => Promise<void>): Promise<Uri> {
    return new Promise<Uri>(async (resolve, reject) => {        
        try {
            // Create a stream that will be used to pipe the response to the file
            let response = await axios.request({
                url: uri.toString(),
                method: 'GET',
                responseType: 'stream',
                cancelToken: new axios.CancelToken(cancel => {
                    token.onCancellationRequested(() => {
                        cancel();
                    });
                })
            });

            // Check if the response provides a content-disposition header and use it to create the file name
            let fileName = `${Math.random().toString(36).substring(2, 15)}.tmp`;
            if (response.headers['content-disposition']) {
                let contentDisposition = response.headers['content-disposition'];
                let match = /filename=([^;]+)/g.exec(contentDisposition);
                if (match && match.length > 1) {
                    fileName = match[1];
                }
            }

            // Create a temporary file to store the downloaded file
            let tempPath = join(tmpdir(), fileName);
            const fileStream = createWriteStream(tempPath);

            // Pipe the response to the file
            response.data.pipe(fileStream);

            // When the download is complete, extract the file if necessary and resolve the promise
            fileStream.on('finish', async () => {
                if (extract) {
                    const zip = new StreamZip({
                        file: tempPath,
                        storeEntries: true
                    });

                    zip.on('ready', () => {
                        // Extract all the contents of the zip file to the same directory
                        let targetPath = tempPath.substring(0, tempPath.lastIndexOf('.'));
                        zip.extract(null, targetPath, async (err) => {
                            if (err) {
                                reject(err);
                            }

                            // Close the streams
                            fileStream.close();
                            zip.close();

                            try {
                                // Try to delete the zip file
                                await fs.rm(tempPath);
                            } catch (error) {
                                reject(error);
                            }
                            
                            resolve(Uri.file(targetPath));
                        });
                    });
                } else {
                    fileStream.close();
                    resolve(Uri.file(tempPath));
                }
            });

            // Report progress as the file is downloaded
            let lastProgress = 0;
            let total = response.headers['content-length'] ? parseInt(response.headers['content-length']) : undefined;
            response.data.on('data', (chunk: Buffer) => {
                callback(lastProgress += chunk.length, total);
            });
        } catch (error) {
            reject(error);
        }
    });
}