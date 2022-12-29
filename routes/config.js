const axios = require("axios");
const playlistCollection = require("../playlists.json");
const fs = require("fs");
const path = require("path");
const express = require('express');
const router = express.Router();

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
                "http"+jfUrl+"/Playlists?api_key="+process.env.JF_API_KEY, {
                    Name: el.plS,
                    userId: process.env.JF_UID
                }, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
            )

            jfPlId = jfPlId.data.Id

            if(!el.nieuw && playlistObj.name !== el.plS){
                oldJfPlaylists = oldJfPlaylists.filter(e => e !== playlistObj.jfID)
                await axios.delete(
                    "http"+jfUrl+"/Items/"+playlistObj.jfID+"?api_key="+process.env.JF_API_KEY, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
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
                "http"+jfUrl+"/Items/"+el+"?api_key="+process.env.JF_API_KEY, {headers: { "Accept-Encoding": "gzip,deflate,compress" }},
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

module.exports = router