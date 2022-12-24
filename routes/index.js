const express = require('express');
const router = express.Router();
const axios = require('axios');
const YoutubeMp3Downloader = require("youtube-mp3-downloader");
const NodeID3 = require('node-id3')
const path = require("path");
const fs = require("fs");
const xml2js = require('xml2js');
const songs = {};
const playlists = {};
const sharp = require('sharp');

//Configure YoutubeMp3Downloader with your settings
const YD = new YoutubeMp3Downloader({
    "ffmpegPath": "C:\\Users\\renau\\Downloads\\ffmpeg-4.4.1-win-64\\ffmpeg.exe",        // FFmpeg binary location
    "outputPath": path.join(__dirname, '..\\tmp\\songs'),    // Output file location (default: the home directory)
    "youtubeVideoQuality": "highestaudio",  // Desired video quality (default: highestaudio)
    "queueParallelism": 50,                  // Download parallelism (default: 1)
    "progressTimeout": 10000,                // Interval in ms for the progress reports (default: 1000)
    "allowWebm": false                      // Enable download from WebM sources (default: false)
});

const parser = new xml2js.Parser();
fs.readFile(path.join(__dirname, '..\\playlist.xml'), function(err, data) {

    parser.parseString(data, function (err, result) {
        playlists["PLXmxSB_pMoBFJOOMid8ByPZFgyILsn9ra"]=result

        console.dir(result.Item.PlaylistItems[0].PlaylistItem[result.Item.PlaylistItems[0].PlaylistItem.length-1]);
        console.log('Done');
    });
});


/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('index', { title: 'Express' });
});

function myPeriodicMethod() {
    console.log("test")
    setTimeout(myPeriodicMethod, 5000);
}

// schedule the first invocation:
//setTimeout(myPeriodicMethod, 5000);

async function getLinks() {

    let url="PLXmxSB_pMoBFJOOMid8ByPZFgyILsn9ra"
    let response = {}
    response.data  ={};
    response.data.nextPageToken = "A"

    while(response.data.nextPageToken !== undefined){

        let pageToken =""
        if(response.data.nextPageToken!=="A")
            pageToken = "&pageToken="+response.data.nextPageToken

        response = await axios({
            method: "get",
            url: "https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50"+pageToken+"&playlistId="+url+"&key="+process.env.YT_API_KEY,
        })

        for(let el of response.data.items)
            songs[el.snippet.resourceId.videoId] = el;
    }


    for(const [key, value] of Object.entries(songs)) {
        YD.download(value.snippet.resourceId.videoId, value.snippet.resourceId.videoId+".mp3")
        addSong(value.snippet.resourceId.videoId)
    }
}

getLinks();

//Download video and save as MP3 file
//YD.download("B4BhhKmIhcY");

YD.on("finished", async function (err, data) {
    let el = songs[data.videoId]
    let description = el.snippet.description.split(/\r?\n/);
    let info = description[2].split(" · ")
    const metadata = {
        artist: info[1],
        title: info[0],
    };

    let height = el.snippet.thumbnails[Object.keys(el.snippet.thumbnails)[Object.keys(el.snippet.thumbnails).length - 1]].height;
    await axios
        .get(el.snippet.thumbnails[Object.keys(el.snippet.thumbnails)[Object.keys(el.snippet.thumbnails).length - 1]].url, {
            responseType: "text",
            responseEncoding: "base64",
        })
        .then(async (resp) => {
            const uri = resp.data.split(';base64,').pop()
            let imgBuffer = Buffer.from(uri, 'base64');
            await sharp(imgBuffer)
                .resize(height, height)
                .toFile(path.join(__dirname, '..\\tmp\\img\\' + data.videoId + ".jpg"))
                .catch(err => console.log(`downisze issue ${err}`))
        })

    let title
    let artist

    try {
        title= info[0]
    } catch (error) {
        title = "Unknown"
    }
    try {
        artist= info[1]
    } catch (error) {
        artist = "Unknown"
    }
    const tags = {
        title: title,
        artist: artist,
        APIC: path.join(__dirname, '..\\tmp\\img\\' + data.videoId + ".jpg"),
    }

    await NodeID3.write(tags, path.join(__dirname, '..\\tmp\\songs\\'+data.videoId+".mp3"), function(err) {  })
    songs[data.videoId]=null
});

YD.on("error", function(error) {
    console.log(error);
});

YD.on("progress", function(progress) {
    console.log(JSON.stringify(progress));
});

function addSong(playlist, data){
    playlists[playlist].Item.PlaylistItems[0].PlaylistItem[result.Item.PlaylistItems[0].PlaylistItem.length] = { Path: [ '/media/OneDrive/'+data+'.mp3' ] }
}
async function writePlaylists(){
    var builder = new xml2js.Builder();

    for(let el of playlists){
        var xml = builder.buildObject(result);
        await fs.writeFileSync(path.join(__dirname, '..\\playlists\\'+el+'\\playlist.xml'), el, function (err) {
            if (err) throw err;
        });
    }

}

module.exports = router;
