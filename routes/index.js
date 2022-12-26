const express = require('express');
const router = express.Router();
const axios = require('axios');
const YoutubeMp3Downloader = require("youtube-mp3-downloader");
const NodeID3 = require('node-id3')
const path = require("path");
const fs = require("fs");
let songs = {};
let ytPlaylists = {};
let jfPlaylists = {};
let deleteFromPlaylistQueue = {};   // with jf IDs
let lib;
const sharp = require('sharp');
let playlistCollection

while(!fs.existsSync(path.join(__dirname, '..\\playlists.json')))
    fs.writeFileSync(path.join(__dirname, '..\\playlists.json'), "{\"playlists\":[]}")

try{
    playlistCollection = require('../playlists.json');
} catch(e){}

//Configure YoutubeMp3Downloader with your settings
const YD = new YoutubeMp3Downloader({
    "ffmpegPath": "C:\\Users\\renau\\Downloads\\ffmpeg-4.4.1-win-64\\ffmpeg.exe",        // FFmpeg binary location
    "outputPath": path.join(__dirname, '..\\tmp\\songs'),    // Output file location (default: the home directory)
    "youtubeVideoQuality": "highestaudio",  // Desired video quality (default: highestaudio)
    "queueParallelism": 50,                  // Download parallelism (default: 1)
    "progressTimeout": 10000,                // Interval in ms for the progress reports (default: 1000)
    "allowWebm": false                      // Enable download from WebM sources (default: false)
});


/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'Playlist config', data: JSON.stringify(playlistCollection) });
});

router.post('/', function(req, res) {
    async function verwerk(){

        const IDs = []
        const plS = []
        for (const el of req.body){
            IDs.push(el.ID)
            plS.push(el.plS)
        }
        if((new Set(IDs)).size !== IDs.length || (new Set(plS).size !== plS.length))
            return res.send("duplicates")

        let oldJfPlaylists = getJfPlaylists() // all jf ids
        let oldYtPlaylists = getYtPlaylists() // all yt ids

        for(const el of req.body){
            let playlistObj = playlistCollectionContainsYT(el.ID)
            oldYtPlaylists = oldYtPlaylists.filter(e => e !== playlistObj.ytID)
            let jfPlId = await axios.post(
                "http://193.123.36.128/Playlists?api_key="+process.env.JF_API_KEY, {
                    Name: el.plS,
                    userId: process.env.JF_UID
                }, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
            )

            jfPlId = jfPlId.data.Id

            if(!el.nieuw && playlistObj.name !== el.plS){
                oldJfPlaylists = oldJfPlaylists.filter(e => e !== playlistObj.jfID)
                await axios.delete(
                    "http://193.123.36.128/Items/"+playlistObj.jfID+"?api_key="+process.env.JF_API_KEY, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
                )
            }

            if(playlistObj){    // yt playlist is al gedownload
                // delete old JSON entry
                const objWithIdIndex = playlistCollection.playlists.findIndex((obj) => obj.jfID === playlistObj.jfID);
                if (objWithIdIndex > -1)
                    playlistCollection.playlists.splice(objWithIdIndex, 1);

                // insert changed JSON
                playlistObj.jfID = jfPlId
                playlistObj.name = el.plS
                playlistCollection.playlists.push(playlistObj)
                fs.writeFileSync(path.join(__dirname, '..\\playlists.json'), JSON.stringify(playlistCollection));
            } else {    // nieuwe yt playlist
                if(el.nieuw){   // in nieuwe jf playlist
                    // create playlist in JF with name el.plS, get jf playlist id
                    // add entry in JSON (el.ID, el.plS, jf playlist id)
                    playlistCollection.playlists.push({"name": el.plS, "ytID": el.ID, "jfID": jfPlId})
                    fs.writeFileSync(path.join(__dirname, '..\\playlists.json'), JSON.stringify(playlistCollection));
                } else {    // in bestaande jf playlist
                    playlistObj = jfPlaylistNameToID(el.plS)
                    if(playlistObj){
                        // bestaande jf playlist verwijderen
                        // remove entry playlistObj from JSON
                        const objWithIdIndex = playlistCollection.playlists.findIndex((obj) => obj.jfID === playlistObj.jfID);
                        if (objWithIdIndex > -1)
                            playlistCollection.playlists.splice(objWithIdIndex, 1);

                        // create playlist in JF with name el.plS, get jf playlist id
                        // add entry in JSON (el.ID, el.plS, jf playlist id)
                        playlistCollection.playlists.push({"name": el.plS, "ytID": el.ID, "jfID": jfPlId})
                        fs.writeFileSync(path.join(__dirname, '..\\playlists.json'), JSON.stringify(playlistCollection));
                    } else
                        console.log("ERROR REGEL 89:  plS:  " + el.plS + "   playlistObject: " + playlistObj)

                }
            }
        }
        //delete unused jf playlists
        for(const el of playlistCollection.playlists)
            oldJfPlaylists = oldJfPlaylists.filter(e => e !== el.jfID)

        for (const el of oldJfPlaylists){
            await axios.delete(
                "http://193.123.36.128/Items/"+el+"?api_key="+process.env.JF_API_KEY, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
            )
        }

        for (const el of oldYtPlaylists){
            const objWithIdIndex = playlistCollection.playlists.findIndex((obj) => obj.ytID === el);
            if (objWithIdIndex > -1)
                playlistCollection.playlists.splice(objWithIdIndex, 1);
        }
        fs.writeFileSync(path.join(__dirname, '..\\playlists.json'), JSON.stringify(playlistCollection));


        res.send("k")
    }

    verwerk()
});

getLibrary().then(r => getLinks())   // executed every 30 seconds

async function getLibrary() {

    lib = await axios.get(
        "http://193.123.36.128/items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&parentId="+process.env.JF_LIBID+"&Fields=Path", {
            headers: { "Accept-Encoding": "gzip,deflate,compress" }
        }
    )
    lib = lib.data.Items

    setTimeout(getLibrary, 30000); // om de 30 seconden library scannen
}

async function getLinks() {

    ytPlaylists = {};
    let songsN = {};
    const tmpLib = lib

    for(let el of playlistCollection.playlists) {
        let url = el.ytID
        ytPlaylists[url] = []
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

            for(let el2 of response.data.items){
                songsN[el2.snippet.resourceId.videoId] = el2;
                ytPlaylists[url][ytPlaylists[url].length] = el2.snippet.resourceId.videoId;
            }
        }

        //checken als er liedjes in JF playlist zitten die niet in yt playlist zitten
        let jfPlaylist = await axios.get(
            "http://193.123.36.128/Playlists/"+el.jfID+"/Items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&Fields=Path", {
                headers: { "Accept-Encoding": "gzip,deflate,compress" }
            }
        )
        jfPlaylists[el.jfID] = jfPlaylist.data.Items

        for(const value of Object.values(jfPlaylist.data.Items)){
            let ytId = jfToYtId(jfPlaylist.data.Items, value.Id)
            if(!YTPlaylistContains(ytPlaylists[url], ytId) && fs.existsSync("C:\\Users\\renau\\OneDrive\\Muziek\\"+ytId+".mp3") ) { // and not in library
                deleteFromPlaylistQueue[value.Id] = true
                fs.unlinkSync("C:\\Users\\renau\\OneDrive\\Muziek\\" + ytId + ".mp3");
            }
        }
        for(const key of Object.keys(deleteFromPlaylistQueue)){
            if(!jfLibraryContains(lib, key)){    // kunt pas uit playlist verwijderen alst ni meer in JF library zit, lol
                await axios.delete(
                    "http://193.123.36.128/Playlists/"+el.jfID+"/Items?EntryIds="+key+"&api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID, {
                        headers: { "Accept-Encoding": "gzip,deflate,br" }
                    }
                )
                delete deleteFromPlaylistQueue[key]
            } else {
                const objWithIdIndex = tmpLib.findIndex((obj) => obj.Id === key);

                if (objWithIdIndex > -1)
                    tmpLib.splice(objWithIdIndex, 1);
            }
        }

        // check for songs in jf library without playlist
        for(const jfSong of jfPlaylists[el.jfID]){
            // remove entry from tmpLib with Id=jfSong.Id
            for(const libEntry of tmpLib)
                if(libEntry.Id === jfSong.Id){
                    const objWithIdIndex = tmpLib.findIndex((obj) => obj.Id === jfSong.Id);

                    if (objWithIdIndex > -1)
                        tmpLib.splice(objWithIdIndex, 1);
                }
        }
    }
    songs = songsN

    // download songs which are not in media folder
    for(const key of Object.keys(songs)){
        if(!fs.existsSync(path.join(__dirname, '..\\tmp\\songs\\'+key+".mp3")) && !fs.existsSync("C:\\Users\\renau\\OneDrive\\Muziek\\"+key+".mp3")){
            YD.download(key, key+".mp3")
        }
    }

    // check for songs in jf library which are not in their playlists
    for(const el of Object.entries(ytPlaylists)){
        const jfPlID = playlistCollectionContainsYT(el[0]).jfID
        const ytPlaylist = ytPlaylists[el[0]]
        const jfPlaylist = jfPlaylists[jfPlID]
        if(ytPlaylist.length !== jfPlaylist.length)
            for(const el of ytPlaylist){
                const jfId = ytToJfId(lib, el)
                if(jfId)
                    if(!jfLibraryContains(jfPlaylist, jfId)){
                        await axios.post(
                            "http://193.123.36.128/Playlists/"+jfPlID+"/Items?Ids="+jfId+"&api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID, {
                                headers: { "Accept-Encoding": "gzip,deflate,compress" }
                            }
                        )

                        const objWithIdIndex = tmpLib.findIndex((obj) => obj.Id === jfId);

                        if (objWithIdIndex > -1)
                            tmpLib.splice(objWithIdIndex, 1);
                    }
            }
    }

    // in library maar niet meer in een playlist (nodig voor geval bestaande jf playlist, nieuwe yt playlist) -> oude yt playlist verwijderen
    for(const el of tmpLib){
        try{
            fs.unlinkSync("C:\\Users\\renau\\OneDrive\\Muziek\\" + jfToYtId(tmpLib,el.Id) + ".mp3");
            deleteFromPlaylistQueue[el.Id] = true
        } catch(e){}
    }

    setTimeout(getLinks, 30000); // om de 30 seconden library scannen
}

YD.on("finished", async function (err, data) {
    let el = songs[data.videoId]
    let description = el.snippet.description.split(/\r?\n/);
    let info = description[2].split(" · ")

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
        }).catch(function (error) {
            console.error(error, error.message)
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

    await new Promise(r => setTimeout(r, 500)); // random delay wnt anders werkt et ni fz

    await fs.rename( path.join(__dirname, '..\\tmp\\songs\\'+data.videoId+".mp3") , "C:\\Users\\renau\\OneDrive\\Muziek\\"+data.videoId+".mp3", (err)=>{
        if(err)throw err;
    });
    fs.unlinkSync(path.join(__dirname, '..\\tmp\\img\\' + data.videoId + ".jpg"));

});

YD.on("error", function(error) {
    console.log(error);
});

YD.on("progress", function(progress) {
    console.log(JSON.stringify(progress));
});

function YTPlaylistContains(playlist, ytId) {
    for(const el of playlist)
        if(ytId === el)
            return true
    return false;
}
function jfLibraryContains(library, jfId){
    for(const value of Object.values(library))
        if(value.Id === jfId)
            return true
    return false
}

function ytToJfId(library, ytId) {
    //console.log(playlist.data.Items)
    for(const value of Object.values(library))
        if(value.Path === "/media/OneDrive/"+ytId+".mp3")
            return value.Id
    //console.log("conversion failed")
    //console.log(info)
    return null
}

function jfToYtId(library, jfId) {
    for(const value of Object.values(library))
        if(value.Id === jfId)
            return value.Path.split("/")[3].split(".")[0]
}

function playlistCollectionContainsYT(ytPlId){
    for(const el of Object.values(playlistCollection.playlists)){
        if (el.ytID === ytPlId)
            return el
    }
    return false
}
function jfPlaylistNameToID(jfPlName){
    for(const el of Object.values(playlistCollection.playlists)){
        if (el.name === jfPlName)
            return el
    }
    return false
}

function getJfPlaylists(){
    const playlists = []
    for (const el of Object.values(playlistCollection.playlists))
        playlists.push(el.jfID)
    return playlists
}

function getYtPlaylists(){
    const playlists = []
    for (const el of Object.values(playlistCollection.playlists))
        playlists.push(el.ytID)
    return playlists
}

module.exports = router;
