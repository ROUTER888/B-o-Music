const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Bot is alive!');
});

function keepAlive() {
    app.listen(8080, () => {
        console.log('Server keep-alive đã sẵn sàng tại port 8080!');
    });
}

module.exports = keepAlive;