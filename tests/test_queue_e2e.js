const http = require('http');

function post(action, params = {}) {
    return new Promise(r => {
        const d = JSON.stringify({ action, params });
        http.request({
            hostname: '127.0.0.1',
            port: 54321,
            path: '/command',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': d.length }
        }, (res) => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => r(JSON.parse(b)));
        }).end(d);
    });
}

(async () => {
    console.log('Setting up queue with 2 test prompts...');
    await post('updateSchedule', {
        enabled: true,
        mode: 'queue',
        queueMode: 'consume',
        prompts: [
            'QUEUE_TEST_1: Say OK and stop',
            'QUEUE_TEST_2: Say OK and stop'
        ],
        silenceTimeout: 20
    });

    console.log('Starting queue...');
    const start = await post('startQueue');
    console.log('  Start result:', start.success ? '✓' : '✗');

    await new Promise(r => setTimeout(r, 2000));

    const status = await post('getQueueStatus');
    console.log('\nQueue Status:');
    console.log('  Running:', status.status?.isRunningQueue);
    console.log('  Index:', status.status?.queueIndex);
    console.log('  Current:', status.status?.currentPrompt?.text);
})();
