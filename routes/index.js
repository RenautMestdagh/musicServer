const express = require('express');
const router = express.Router();
const path = require("path");
const fs = require("fs");
const axios = require('axios');
const youtubedl = require('youtube-dl-exec');

const {execSync} = require("child_process");
const sharp = require('sharp');
const ffmetadata = require("ffmetadata");

let songs = {};
let ytPlaylists = {};
let jfPlaylists = {};
let deleteFromPlaylistQueue = {};   // with jf IDs
let lib;

let playlistCollection = require('../playlists.json');

let ffmpegPath
let libPath
if (process.env.NODE_ENV === "production"){
    ffmpegPath = "/usr/bin/ffmpeg";
    libPath = "/media/OneDrive/"
} else {
    ffmpegPath = path.join(__dirname, '../ffmpeg.exe');
    libPath = "C:/Users/renau/OneDrive/Muziek/"
}
ffmetadata.setFfmpegPath(ffmpegPath)


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
                fs.writeFileSync(path.join(__dirname, '../playlists.json'), JSON.stringify(playlistCollection));
            } else {    // nieuwe yt playlist
                if(el.nieuw){   // in nieuwe jf playlist
                    // create playlist in JF with name el.plS, get jf playlist id
                    // add entry in JSON (el.ID, el.plS, jf playlist id)
                    playlistCollection.playlists.push({"name": el.plS, "ytID": el.ID, "jfID": jfPlId})
                    fs.writeFileSync(path.join(__dirname, '../playlists.json'), JSON.stringify(playlistCollection));
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
                        fs.writeFileSync(path.join(__dirname, '../playlists.json'), JSON.stringify(playlistCollection));
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
        fs.writeFileSync(path.join(__dirname, '../playlists.json'), JSON.stringify(playlistCollection));


        res.send("k")
    }

    verwerk()
});

function executeAll(){
    getLibrary().then(r => clearOldTmp().then(r => getLinks()))
    setTimeout(executeAll, 600000); // om de 10 minuten alles uitvoeren
}
executeAll();

async function getLibrary() {

    lib = await axios.get(
        "http://193.123.36.128/items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&parentId="+process.env.JF_LIBID+"&Fields=Path", {
            headers: { "Accept-Encoding": "gzip,deflate,compress" }
        }
    )
    lib = lib.data.Items
}

async function clearOldTmp() {
    const songs = fs.readdirSync(path.join(__dirname, '../tmp/songs/'))
    const img = fs.readdirSync(path.join(__dirname, '../tmp/img/'))

    for(const file of songs)
        fs.unlinkSync(path.join(__dirname, '../tmp/songs/'+file))

    for(const file of img)
        fs.unlinkSync(path.join(__dirname, '../tmp/img/'+file))
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
                songsN[el2.snippet.resourceId.videoId] = {};
                songsN[el2.snippet.resourceId.videoId].yt1=el2
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
            if(!YTPlaylistContains(ytPlaylists[url], ytId) && fs.existsSync(libPath+ytId+".mp3") ) { // and not in library
                deleteFromPlaylistQueue[value.Id] = true
                fs.unlinkSync(libPath+ytId + ".mp3");
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
    const maxAtSameTime = 10
    let currentAtSameTime = 0
    for(const ytId of Object.keys(songs)){
        await new Promise(r => setTimeout(r, 100)); // beetje splitsen want er geraken er 2 uit de loop bij elke -
        if(!fs.existsSync(path.join(__dirname, '../tmp/songs/'+ytId+".mp3")) && !fs.existsSync(path.join(__dirname, '../tmp/songs/'+ytId+".webm")) && !fs.existsSync(libPath+ytId+".mp3")){
            while(currentAtSameTime >= maxAtSameTime){
                await new Promise(r => setTimeout(r, 10000)); // 10 seconden wachten voor opnieuw check
            }
            currentAtSameTime ++
            youtubedl('https://music.youtube.com/watch?v='+ytId, {
                dumpSingleJson: true,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                addHeader: [
                    'referer:youtube.com',
                    'user-agent:googlebot'
                ]
            }).then( function(response){
                songs[ytId].thumbnail = response.thumbnail
                songs[ytId].yt2 = response
                // if yt song, these are null
                let tags = ['album','artist','track','release_year']
                for(const tag of tags)
                    try{
                        songs[ytId][tag] = response[tag]
                    } catch(e){}

                (async () => {
                    try {
                        console.log(Object.values(response.requested_formats)[1].url)
                        const {data} = await axios.get(Object.values(response.requested_formats)[1].url, {responseType: 'arraybuffer'});
                        fs.writeFileSync(path.join(__dirname, '../tmp/songs/'+ytId+".webm"), data, 'binary');
                        execSync('ffmpeg -hide_banner -loglevel error -i '+path.join(__dirname, '../tmp/songs/'+ytId+".webm")+' -vn '+path.join(__dirname, '../tmp/songs/'+ytId+".mp3"), { encoding: 'utf-8' });  // the default is 'buffer'
                        fs.unlinkSync(path.join(__dirname, '../tmp/songs/'+ytId+".webm"))
                        currentAtSameTime--
                        songDone(ytId)
                    } catch (err) {
                        console.log(err);
                    }
                })();
                //console.log(Object.values(response.requested_formats)[1])
            })
            //YD.download(key, key+".mp3")
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
            fs.unlinkSync(libPath+jfToYtId(tmpLib,el.Id) + ".mp3");
            deleteFromPlaylistQueue[el.Id] = true
        } catch(e){}
    }
}

async function songDone(ytId) {
    let el = songs[ytId]

    await axios
        .get(el.thumbnail, {
            responseType: "text",
            responseEncoding: "base64",
        })
        .then(async (resp) => {
            const uri = resp.data.split(';base64,').pop()
            let imgBuffer = Buffer.from(uri, 'base64');
            await sharp(imgBuffer)
                .resize(1080, 1080)
                .toFile(path.join(__dirname, '../tmp/img/' + ytId + ".jpg"))
                .catch(err => console.log(`downisze issue ${err}`))
        }).catch(function (error) {
            retryGetRequest(el.thumbnail)
        })


    const tags = {
        title: el.track,
        artist: el.artist,
        album: el.album,
        year: el.release_year,
    }

    await ffmetadata.write(path.join(__dirname, '../tmp/songs/'+ytId+".mp3"), tags,  function(err) {
        execSync('ffmpeg -hide_banner -loglevel error -i '+path.join(__dirname, '../tmp/songs/'+ytId+".mp3")+' -i '+path.join(__dirname, '../tmp/img/'+ytId+".jpg -map 0:0 -map 1:0 -c copy -id3v2_version 3 -metadata:s:v title=\"Album cover\" -metadata:s:v comment=\"Cover (front)\" "+libPath+ytId+".mp3"), { encoding: 'utf-8' });  // the default is 'buffer'
        fs.unlinkSync( path.join(__dirname, '../tmp/songs/'+ytId+".mp3"));
        fs.unlinkSync(path.join(__dirname, '../tmp/img/' + ytId + ".jpg"));
    })
}

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

const retryGetRequest = async (url) => {

    while (true)
        try {
            return await axios.get(url, {
                responseType: "text",
                responseEncoding: "base64",
            })
        } catch (error) {
            console.log("trying again")
        }
}

module.exports = router;
