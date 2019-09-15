const port = parseInt(process.env.PORT)
const mongoUrl = process.env.MONGO_URL
const twilioSID = process.env.TWILIO_SID
const twilioToken = process.env.TWILIO_TOKEN
const revaiToken = process.env.REVAI_TOKEN.trim()

const twilioClient = require('twilio')(twilioSID, twilioToken)
const twiml = require('twilio').twiml
const revai = require('revai-node-sdk')
const revaiClient = new revai.RevAiApiClient(revaiToken)
const mongo = require('mongodb')
const express = require('express')
const app = express()

const bodyParser = require('body-parser')
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

const mongoClient = new mongo.MongoClient(mongoUrl, {autoReconnect: true});
mongoClient.connect(function(err, client) {
    if (err) throw err;
    console.log("Connected successfully to mongo server");
    
});
const db = () => mongoClient.db('main');

function joinTranscript(transcript) {
    return transcript.map(e => e.value).join(' ');
}

function printDoc(doc) {
    newdoc = {};
    for (key in doc) {
        if (key !== 'transcript') newdoc[key] = doc[key];
    }
    console.log(JSON.stringify(newdoc, null, 2));
}

app.get('/api/disasters', function(req, res) {
    res.json({disasters: [{lat: 3, lon: 4}, {lat: 5, lon: 6}]});
});

const fakeLocations = {
    '0': [0, 0],
    '1': [0, 0],
    '2': [0, 0],
    '3': [0, 0],
    '4': [0, 0],
    '5': [0, 0],
    '6': [0, 0],
    '7': [0, 0],
    '8': [0, 0],
    '9': [0, 0]
};

app.post('/call/start', function(req, res) {
    const t = new twiml.VoiceResponse();

    if (req.body.Digits) {
        console.log('Received call with digit ' + req.body.Digits + ', beginning recording');
        t.record({
            recordingStatusCallback: '/call/complete',
            recordingStatusCallbackMethod: 'POST',
            recordingStatusCallbackEvent: 'completed'
        });
        t.hangup();
        db().collection('calls').insertOne({sid: req.body.CallSid, loc: fakeLocations[req.body.Digits]});
        console.log('loc: ' + fakeLocations[req.body.Digits]);
    } else {
        t.gather({ numDigits: 1 }).say('The nine one one lines are currently busy. Please state your emergency.');
        t.redirect('/call/start');
    }

    res.type('text/xml');
    res.send(t.toString());
});

app.post('/call/complete', function(req, res) {
    console.log('Finished recording: ' + req.body.RecordingUrl);
    db().collection('calls').updateOne({sid: req.body.CallSid}, {$set: {url: req.body.RecordingUrl}});
    revaiClient.submitJobUrl(req.body.RecordingUrl.toString(), {
        skip_diarization: true,
        skip_punctuation: true,
        callback_url: req.protocol + '://' + req.get('host') + req.originalUrl + '/transcribed'
    }).then(function(value) {
        db().collection('calls').updateOne({sid: req.body.CallSid}, {$set: {url: req.body.RecordingUrl, revId: value.id}});
    });
});

app.post('/call/complete/transcribed', function(req, res) {
    if (req.body.job.status === 'failed') {
        console.log('RevAI job ' + req.body.job.id + ' has failed');
        return;
    }
    console.log('Finished transcribing: ' + req.body.job.id);
    revaiClient.getTranscriptObject(req.body.job.id).then(function(value) {
        transcript = value.monologues[0].elements;
        text = joinTranscript(transcript);
        db().collection('calls').updateOne({revId: req.body.job.id}, {$set: {transcript: transcript, text: text}});
        console.log(text);
    });
});

app.post('/repopulate', function(req, res) {
    const results = req.body.ids.split(',').map(async function(elem) {
        details = await revaiClient.getJobDetails(elem);
        transcript = await revaiClient.getTranscriptObject(elem);
        return {url: details.media_url, revId: elem, transcript: transcript.monologues[0].elements, text: joinTranscript(transcript.monologues[0].elements)};
    });
    Promise.all(results).then(function(r) {
        db().collection('calls').insertMany(r);
        combined = r.forEach(printDoc);
    });
});

app.listen(port);
