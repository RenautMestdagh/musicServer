const express = require('express');
const router = express.Router();
const path = require("path");
const fs = require("fs");
const axios = require('axios');
const youtubedl = require('youtube-dl-exec');
require('node-openvpn');
const {execSync} = require("child_process");
const cp = require("child_process");
const { spawn } = require('child_process');
const sharp = require('sharp');

let ytPlaylists = {};
let jfPlaylists = {};
let lib;
let nextExecute
let vpnQueue

const maxAtSameTime = 10
let currentAtSameTime = 0
let busy = false
let update = false
let toExecute = false

let playlistCollection = require('../playlists.json');

let ffmpegPath
let libPath
let jfUrl

if (process.env.NODE_ENV === "production"){
    ffmpegPath = "/usr/bin/ffmpeg";
    libPath = "/media/OneDrive/"
    jfUrl = "http://localhost:8096"
} else {
    ffmpegPath = path.join(__dirname, '../ffmpeg.exe');
    jfUrl = "https://renautmusic.ml"
    if(process.platform === "linux")
        libPath = "/mnt/c/Users/renau/OneDrive/Muziek/"
    else
        libPath = "/Users/renau/OneDrive/Muziek/"
}

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'Playlist config', data: JSON.stringify(playlistCollection) });

    if(toExecute){
        toExecute = false
        if(!busy)
            executeAll();
        else
            update=true
    }
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

        let playlistsRef = playlistCollection.playlists
        let newPlaylists = []

        for(const el of req.body){

            let playlistObj = playlistCollectionContainsName(el.plS)

            if(sameConfig(el)){
                newPlaylists.push(playlistObj)
                continue
            }

            if(el.nieuw){   // in nieuwe jf playlist

                let jfPlId = await axios.post(
                    jfUrl+"/Playlists?api_key="+process.env.JF_API_KEY, {
                        Name: el.plS,
                        userId: process.env.JF_UID
                    }, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
                )
                newPlaylists.push({"name":el.plS,"ytID":el.ID,"jfID":jfPlId.data.Id})

            } else {    // naam jf playlist aanpassen
                if(playlistObj.name!==el.plS)   // als niet de zelfde naam (yt playlist ID is veranderd)
                    await axios.post(
                        jfUrl+"/Items/"+playlistObj.jfID+"?api_key="+process.env.JF_API_KEY, {
                            "Name": el.plS,
                            "Genres": [],
                            "Tags": [],
                            "ProviderIds": {}
                        }, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
                    )
                newPlaylists.push({"name":el.plS,"ytID":el.ID,"jfID":playlistObj.jfID})

            }

        }

        //delete unused jf playlists
        for(const el of playlistsRef){
            let match = false
            for(const ell of newPlaylists)
                if(el.jfID===ell.jfID)
                    match=true
            if(!match){
                await axios.delete(
                    jfUrl+"/Items/"+el.jfID+"?api_key="+process.env.JF_API_KEY, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
                )
            }

        }

        // sort alphabetically by name
        newPlaylists.sort( function( a, b ) {
            a = a.name.toLowerCase();
            b = b.name.toLowerCase();

            return a < b ? -1 : a > b ? 1 : 0;
        });

        fs.writeFileSync(path.join(__dirname, '../playlists.json'), "{\"playlists\":"+JSON.stringify(newPlaylists)+"}");
        playlistCollection = {playlists:newPlaylists}

        toExecute = true
        res.send("k")
    }
    verwerk()
});

async function executeAll(){
    clearTimeout(nextExecute);

    console.log(getTimeStamp()+"----- Execution started -----")
    busy=true
    update=false
    await getLibrary().then(async function(){
        clearOldTmp().then(async function(){
            getLinks().then(function(){
                console.log(getTimeStamp()+"----- Execution complete -----")
                console.log("|")
                busy=false
                nextExecute = setTimeout(executeAll, 600000)    // om de 10 minuten alles uitvoeren
                if(update)
                    executeAll();
            })
        })
    })
}
setTimeout(executeAll, 120000)

async function getLibrary() {

    lib = await axios.get(
        jfUrl+"/items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&parentId="+process.env.JF_LIBID+"&Fields=Path", {
            headers: { "Accept-Encoding": "gzip,deflate,compress" }
        }
    )
    lib = lib.data.Items
}

async function clearOldTmp() {

    for(const file of fs.readdirSync(path.join(__dirname, '../tmp/songs/')))
        fs.unlinkSync(path.join(__dirname, '../tmp/songs/'+file))

    for(const file of fs.readdirSync(path.join(__dirname, '../tmp/img/')))
        fs.unlinkSync(path.join(__dirname, '../tmp/img/'+file))
}

async function getLinks() {

    ytPlaylists = {};
    const songs = new Set();
    vpnQueue = new Set();

    for(let el of playlistCollection.playlists) {
        let url = el.ytID
        ytPlaylists[url] = new Set()
        let response
        let pageToken = ""

        do {
            try{
                response = await axios({
                    method: "get",
                    url: "https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50"+pageToken+"&playlistId="+url+"&key="+process.env.YT_API_KEY,
                })
            } catch(e){
                return console.error(e)    // wss quota overschreden
            }
            pageToken = "&pageToken="+response.data.nextPageToken


            for(let el2 of response.data.items){
                songs.add(el2.snippet.resourceId.videoId)
                ytPlaylists[url].add(el2.snippet.resourceId.videoId);
            }
        }  while(response.data.nextPageToken !== undefined)

        console.log(getTimeStamp()+"YouTube playlist \""+el.name+"\" contains "+ytPlaylists[url].size+" items")
    }

    //checken als er liedjes in JF playlist zitten die niet in een yt playlist zitten
    for(let el of playlistCollection.playlists) {

        let jfPlaylist = await axios.get(
            jfUrl+"/Playlists/"+el.jfID+"/Items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&Fields=Path", {
                headers: { "Accept-Encoding": "gzip,deflate,compress" }
            }
        )
        jfPlaylists[el.jfID] = jfPlaylist.data.Items

        for(const value of Object.values(jfPlaylist.data.Items)) {
            let ytId = jfToYtId(jfPlaylist.data.Items, value.Id)
            if (!YTPlaylistContains(ytPlaylists[el.ytID], ytId)){  // remove from this playlist
                await axios.delete(
                    jfUrl + "/Playlists/" + el.jfID + "/Items?EntryIds=" + value.PlaylistItemId + "&api_key=" + process.env.JF_API_KEY + "&userId=" + process.env.JF_UID, {
                        headers: {"Accept-Encoding": "gzip,deflate,br"}
                    }
                )
                console.log(getTimeStamp()+"Song https://music.youtube.com/watch?v="+ytId+" removed from playlist "+el.name)
            }
        }
    }

    for(const file of fs.readdirSync(libPath)) {
        if (!YTPlaylistsContains(ytPlaylists, file.split(".")[0])) {    // song in jf library but not in single playlist (purging)
            fs.unlinkSync(libPath + file);
            console.log(getTimeStamp()+"Song https://music.youtube.com/watch?v="+file.split(".")[0]+" deleted")
        }
    }

    // download songs which are not in media folder
    for(const ytId of songs){
        if(!fs.existsSync('tmp/songs/'+ytId+".mp3") && !fs.existsSync(libPath+ytId+".mp3")){
            while(currentAtSameTime >= maxAtSameTime){
                await new Promise(r => setTimeout(r, randomIntFromInterval(5000, 10000))); // 10 seconden wachten voor opnieuw check
            }
            currentAtSameTime ++
            console.log(getTimeStamp()+"Start download song https://music.youtube.com/watch?v="+ytId)
            downloadSong(ytId)//, false)
        }
    }

    while(currentAtSameTime !== 0){
        await new Promise(r => setTimeout(r, 5000)); // 5 seconden wachten voor opnieuw check, wachten tegen alles gedownload is
    }

    // if(vpnQueue.size>0){
    //
    //     let vpnProcess
    //     try{
    //         console.log(getTimeStamp()+'Connecting to vpn')
    //         vpnProcess = await connectVPN()
    //         console.log(getTimeStamp()+'Vpn connected')
    //     } catch (e) {
    //         console.error(getTimeStamp()+"Failed to connect to VPN")
    //     }
    //
    //     await cp.exec('curl ifconfig.me', async function(err, stdout) {
    //         await console.log(getTimeStamp()+"vpn ip: "+stdout)
    //     });
    //
    //     if(vpnProcess){
    //         for(const ytId of vpnQueue){
    //             if(!fs.existsSync('tmp/songs/'+ytId+".mp3") && !fs.existsSync(libPath+ytId+".mp3")){
    //                 while(currentAtSameTime >= maxAtSameTime){
    //                     await new Promise(r => setTimeout(r, randomIntFromInterval(5000, 10000))); // 10 seconden wachten voor opnieuw check
    //                 }
    //                 currentAtSameTime ++
    //                 console.log(getTimeStamp()+"Start download song https://music.youtube.com/watch?v="+ytId+" with vpn")
    //                 downloadSong(ytId, true)
    //             }
    //         }
    //
    //         while(currentAtSameTime !== 0){
    //             await new Promise(r => setTimeout(r, 5000)); // 5 seconden wachten voor opnieuw check, wachten tegen alles me vpn gedownload is
    //         }
    //         vpnProcess.kill()
    //         console.log(getTimeStamp()+'Vpn disconnected')
    //     }
    //
    // }


    // check for songs in jf library which are not in their playlists
    for(const el of Object.keys(ytPlaylists)){
        const playlistObject = playlistCollectionContainsYT(el)
        const jfPlID = playlistObject.jfID
        const ytPlaylist = ytPlaylists[el]
        const jfPlaylist = jfPlaylists[jfPlID]

        if(ytPlaylist.length !== jfPlaylist.length)
            for(const el of ytPlaylist){
                const jfId = ytToJfId(lib, el)
                if(jfId)
                    if(!jfLibraryContains(jfPlaylist, jfId)){
                        await axios.post(
                            jfUrl + "/Playlists/" + jfPlID + "/Items?Ids=" + jfId + "&api_key=" + process.env.JF_API_KEY + "&userId=" + process.env.JF_UID, {
                                headers: {"Accept-Encoding": "gzip,deflate,compress"}
                            }
                        )
                        console.log(getTimeStamp()+"Song https://music.youtube.com/watch?v="+el+" added to playlist "+playlistObject.name)
                    }
            }
    }
}

async function downloadSong(id){//, vpn){

    let logging=""
    // if(vpn)
    //     logging = "with vpn "
    // else
    //     logging = "without vpn"

    let metadata

    try{
        metadata = await youtubedl("https://music.youtube.com/watch?v="+id, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:googlebot'
            ],
            //proxy: 'https://renaut.mestdagh%40gmail.com:q8Cz%267jEm5%23yuz7L@be.lazerpenguin.com:443'
        })

        await youtubedl("https://music.youtube.com/watch?v="+id, {
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:googlebot'
            ],
            output:"tmp/songs/"+id+"X.mp3",
            format: "bestaudio",
            //proxy: 'https://renaut.mestdagh%40gmail.com:q8Cz%267jEm5%23yuz7L@be.lazerpenguin.com:443'
        }).then(function(){
            if(!fs.existsSync('tmp/songs/'+id+"X.mp3")){
                console.error(getTimeStamp()+"Song https://youtube.com/watch?v="+id+" failed to download "+logging+"but WEIRD")
                return currentAtSameTime--
            }
            process()
        })

    } catch (e) {
        // console.error(e)
        console.error(getTimeStamp()+"Song https://youtube.com/watch?v="+id+" failed to download "+logging)
        //if(!vpn)
          //  vpnQueue.add(id)
        return currentAtSameTime --
    }

    async function process(){

        let count = 0;
        const maxTries = 5;
        while(true) {
            try{
                await axios
                    .get(metadata.thumbnail, {
                        responseType: "text",
                        responseEncoding: "base64",
                    })
                    .then(async (resp) => {
                        const uri = resp.data.split(';base64,').pop()
                        let imgBuffer = Buffer.from(uri, 'base64');
                        await sharp(imgBuffer)
                            .resize(1080, 1080)
                            .toFile('tmp/img/' + metadata.id + ".jpg")
                            .catch(err => console.log(`downisze issue ${err}`))

                    })
                break
            } catch (e) {
                if (++count === maxTries) {
                    console.error(getTimeStamp()+"Picture "+metadata.thumbnail+" failed to download")
                    return currentAtSameTime--
                }
            }
        }


        //'ffmpeg -i ' + 'tmp/songs/' + metadata.id + 'X.mp3 -id3v2_version 3 ' +
        //             ' -metadata title="' + metadata.track +
        //             '" -metadata artist="' + metadata.artist +
        //             '" -metadata album="' + metadata.album +
        //             '" tmp/songs/' + id + ".mp3"

        let toExecute = 'ffmpeg -hide_banner -loglevel error -i ' + 'tmp/songs/' + metadata.id + 'X.mp3 -id3v2_version 3 '
        if(metadata.track)
            toExecute += ' -metadata title="' + metadata.track.replaceAll('"','\\"').replaceAll(/'/g,'\'')
        else
            toExecute += ' -metadata title="' + metadata.uploader.replaceAll('"','\\"').replaceAll(/'/g,'\'')
        if(metadata.artist)
            toExecute += '" -metadata artist="' + metadata.artist.replaceAll('"','\\"').replaceAll(/'/g,'\'')
        else
            toExecute += '" -metadata artist="' + metadata.fulltitle.replaceAll('"','\\"').replaceAll(/'/g,'\'')
        if(metadata.album)
            toExecute += '" -metadata album="' + metadata.album.replaceAll('"','\\"').replaceAll(/'/g,'\'')
        toExecute += '" tmp/songs/' + id + ".mp3"

        try{
            execSync(toExecute, {encoding: 'utf-8'});
        } catch(e) {
            console.error(e)
            return currentAtSameTime--
        }

        fs.unlinkSync('tmp/songs/' + metadata.id + 'X.mp3')

        execSync('ffmpeg -hide_banner -loglevel error -i tmp/songs/' + id + ".mp3"+' -i tmp/img/' + id + ".jpg -map 0:0 -map 1:0 -c copy -id3v2_version 3 " +
            "-metadata:s:v title=\"Album cover\" -metadata:s:v comment=\"Cover (front)\" "+libPath + id + ".mp3", { encoding: 'utf-8' });  // the default is 'buffer'

        fs.unlinkSync('tmp/songs/' + metadata.id + '.mp3')
        fs.unlinkSync('tmp/img/' + metadata.id + '.jpg')

        console.log(getTimeStamp()+"Song https://music.youtube.com/watch?v="+metadata.id+" downloaded")
        currentAtSameTime--
    }
}

async function connectVPN(){

    const vpnProcess = spawn('/bin/sh', ['./vpn/connect.sh'], { shell: true });

    let prev
    let currIp

    await cp.exec('curl ifconfig.me', function(err, stdout) {
        prev=stdout
        currIp=stdout
    });

    let tryNr=0
    while(prev===currIp){    // wachten tegen da vpn verbonden is
        await new Promise(r => setTimeout(r, 5000));
        await cp.exec('curl ifconfig.me', function(err, stdout) {
            currIp=stdout
        });
        tryNr++
        if(tryNr>5)
            throw new Error('Unable to connect to vpn');

    }
    return vpnProcess
}

function sameConfig(ell){
    for(const el of Object.values(playlistCollection.playlists))
        if(el.name === ell.plS && el.ytID === ell.ID)
            return true;
    return false
}
function YTPlaylistContains(playlist, ytId) {
    for(const el of playlist.values())
        if(ytId === el)
            return true
    return false;
}
function YTPlaylistsContains(playlists, ytId) {
    for(const ell of Object.values(playlists))
        for(const el of ell.values())
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
function playlistCollectionContainsName(plName){
    for(const el of Object.values(playlistCollection.playlists)){
        if (el.name === plName)
            return el
    }
    return false
}

function randomIntFromInterval(min, max) { // min and max included
    return Math.floor(Math.random() * (max - min + 1) + min)
}

function getTimeStamp(){
    const d = new Date()
    return "".concat("[",d.getHours().toString().padStart(2, '0'),":",d.getMinutes().toString().padStart(2, '0'),":",d.getSeconds().toString().padStart(2, '0'),"] ")
}

module.exports = router;
