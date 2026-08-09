import fs from 'fs';
import https from 'https';

const url = 'https://biblehub.com/commentaries/clarke/ezra/1.htm';

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        // Print the slice between index 68390 and 68720
        console.log("Raw HTML slice:\n", data.substring(68390, 68725));
    });
}).on('error', (err) => {
    console.error("Error fetching:", err);
});
