// server.js
// where your node app starts

// init project
var express = require('express');
var app = express();

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function (request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

// Proxy transit data to bypass CORS
app.get("/api/transit/:filename", async (request, response) => {
  try {
    const fetchResponse = await fetch(`http://www.guaguas.com/transit/google_transit/${request.params.filename}`);
    if (!fetchResponse.ok) {
      return response.status(fetchResponse.status).send(fetchResponse.statusText);
    }
    const data = await fetchResponse.text();
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.send(data);
  } catch (error) {
    response.status(500).send(error.toString());
  }
});

// listen for requests :)
const PORT = process.env.PORT || 3000;
var listener = app.listen(PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
