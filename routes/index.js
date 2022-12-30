const express = require('express');
const router = express.Router();
const path = require("path");
const fs = require("fs");
const axios = require('axios');
const youtubedl = require('youtube-dl-exec');

const {execSync} = require("child_process");
const sharp = require('sharp');

let songs = {};
let ytPlaylists = {};
let jfPlaylists = {};
let deleteFromPlaylistQueue = {};   // with jf IDs
let lib;

const maxAtSameTime = 10
let currentAtSameTime = 0
let busy = false
let update = false

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
    libPath = "/mnt/c/Users/renau/OneDrive/Muziek/"
    jfUrl = "https://renautmusic.ml"
}

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

                if(playlistObj.name!==el.plS)
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
        const deleted = []
        for(const el of playlistsRef){
            let match = false
            for(const ell of newPlaylists)
                if(el.jfID===ell.jfID)
                    match=true
            if(!match){
                await axios.delete(
                    jfUrl+"/Items/"+el.jfID+"?api_key="+process.env.JF_API_KEY, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
                )
                deleted.push(el.name)
            }

        }

        fs.writeFileSync(path.join(__dirname, '../playlists.json'), "{\"playlists\":"+JSON.stringify(newPlaylists)+"}");
        playlistCollection = {playlists:newPlaylists}

        res.send(JSON.stringify(deleted))
        if(!busy)
            executeAll();
        else
            update=true
    }
    verwerk()
});

function executeAll(){
    busy=true
    update=false
    getLibrary().then(r => clearOldTmp().then(r => getLinks().then(function(){
        busy=false
        if(update)
            executeAll();
        setTimeout(executeAll, 600000)
    })))   // om de 10 minuten alles uitvoeren)))
}
executeAll();

async function getLibrary() {

    lib = await axios.get(
        jfUrl+"/items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&parentId="+process.env.JF_LIBID+"&Fields=Path", {
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
            jfUrl+"/Playlists/"+el.jfID+"/Items?api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID+"&Fields=Path", {
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
                    jfUrl+"/Playlists/"+el.jfID+"/Items?EntryIds="+key+"&api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID, {
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
    for(const ytId of Object.keys(songs)){
        await new Promise(r => setTimeout(r, 500)); // beetje splitsen want er geraken er 2 uit de loop bij elke -
        if(!fs.existsSync('tmp/songs/'+ytId+".mp3") && !fs.existsSync(libPath+ytId+".mp3")){
            while(currentAtSameTime >= maxAtSameTime){
                await new Promise(r => setTimeout(r, 5000)); // 10 seconden wachten voor opnieuw check
            }
            currentAtSameTime ++
            console.log("Currently downloading: "+ytId)
            downloadSong(ytId)
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
                            jfUrl+"/Playlists/"+jfPlID+"/Items?Ids="+jfId+"&api_key="+process.env.JF_API_KEY+"&userId="+process.env.JF_UID, {
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
async function downloadSong(id){

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
            ]
        })
    } catch (e) {
        console.log("VIDEO "+id+" FAILED TO DOWNLOAD")
        console.log(e)
        // use proxy 194.78.203.207:8111
        try{
            metadata = await youtubedl("https://music.youtube.com/watch?v="+id, {
                dumpSingleJson: true,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                geoVerificationProxy: "socks5://194.78.203.207:8111/",
                addHeader: [
                    'referer:youtube.com',
                    'user-agent:googlebot'
                ]
            })
            await youtubedl("https://music.youtube.com/watch?v="+id, {
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                geoVerificationProxy: "socks5://194.78.203.207:8111/",
                addHeader: [
                    'referer:youtube.com',
                    'user-agent:googlebot'
                ],
                output:"tmp/songs/"+id+"X.mp3",
                format: "bestaudio",
            }).then(process())
        } catch (e) {
            currentAtSameTime --
            console.log("PROXY FAILED")
            console.log(e)
            return
        }
        currentAtSameTime --
        return
    }


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
    }).then(process())

    async function process(){

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

            }).catch(function (error) {
                console.error(error, error.message)
            })

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
            toExecute += '" -metadata artist="' + metadata.artist.replaceAll('"','\\"').replaceAll(/'/g,'\\\'')
        else
            toExecute += '" -metadata artist="' + metadata.fulltitle.replaceAll('"','\\"').replaceAll(/'/g,'\'')
        if(metadata.album)
            toExecute += '" -metadata album="' + metadata.album.replaceAll('"','\\"').replaceAll(/'/g,'\\\'')
        toExecute += '" tmp/songs/' + id + ".mp3"

        execSync(toExecute, {encoding: 'utf-8'});

        fs.unlinkSync('tmp/songs/' + metadata.id + 'X.mp3')

        execSync('ffmpeg -hide_banner -loglevel error -i tmp/songs/' + id + ".mp3"+' -i tmp/img/' + id + ".jpg -map 0:0 -map 1:0 -c copy -id3v2_version 3 " +
            "-metadata:s:v title=\"Album cover\" -metadata:s:v comment=\"Cover (front)\" "+libPath + id + ".mp3", { encoding: 'utf-8' });  // the default is 'buffer'

        fs.unlinkSync('tmp/songs/' + metadata.id + '.mp3')
        fs.unlinkSync('tmp/img/' + metadata.id + '.jpg')
        currentAtSameTime --
    }
}

function sameConfig(ell){
    for(const el of Object.values(playlistCollection.playlists))
        if(el.name === ell.plS && el.ytID === ell.ID)
            return true;
    return false
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
function playlistCollectionContainsName(plName){
    for(const el of Object.values(playlistCollection.playlists)){
        if (el.name === plName)
            return el
    }
    return false
}

module.exports = router;
