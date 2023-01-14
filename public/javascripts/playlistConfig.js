let data = JSON.parse(document.getElementsByTagName("data")[0].innerText).playlists;
data.push({});
let last=false

for(const el of Object.values(data)){
    if(Object.keys(el).length===0)
        last=true

    addNewNode(el, last, false)
}

const confirm = document.createElement("button");
confirm.innerText = "Save"
confirm.classList.add("confirm")
confirm.addEventListener("click",submit)
document.body.appendChild(confirm)

function addNewNode(el, last, insert){
    const element = document.createElement("div");
    element.classList.add("playlistEl")

    const ytId = document.createElement("a");
    ytId.classList.add("ytId")
    ytId.innerText = "Youtube link:"
    element.appendChild(ytId)

    const urlI = document.createElement("div");
    urlI.classList.add("urlInput");

    const ytIdUrl = document.createElement("a");
    ytIdUrl.innerText = "https://music.youtube.com/playlist?list="
    urlI.appendChild(ytIdUrl)

    const ytIdI = document.createElement("input");
    ytIdI.classList.add("ytIdInput");
    if(!last){
        ytIdI.value = el.ytID;
        ytIdI.addEventListener('change', removeNode);
    } else
        ytIdI.addEventListener('change', addNewLast);
    if(insert && !last)
        ytIdI.addEventListener('change', removeNode);

    urlI.appendChild(ytIdI)

    element.appendChild(urlI)

    const plName = document.createElement("a");
    plName.innerText = "Playlist naam:"
    plName.classList.add("plName")
    element.appendChild(plName)

    const plNameI = document.createElement("select");
    let opt;
    for (const el of Object.values(data)){
        if(Object.keys(el).length===0)
            break
        opt = document.createElement('option');
        opt.value = el.name;
        opt.innerHTML = el.name;
        plNameI.appendChild(opt);
    }
    opt = document.createElement('option');
    opt.value = "NIEUWE PLAYLIST";
    opt.innerHTML = "NIEUWE PLAYLIST";
    plNameI.appendChild(opt);
    if(last)
        plNameI.value="NIEUWE PLAYLIST"
    else
        plNameI.value = el.name;
    plNameI.classList.add("plName")

    plNameI.addEventListener('change', (event) => {
        event.target.nextSibling.disabled = event.target.value !== "NIEUWE PLAYLIST";
    });

    element.appendChild(plNameI)

    const nPlaylist = document.createElement("input");
    if(!last)
        nPlaylist.disabled = true
    element.appendChild(nPlaylist)

    if(!insert)
        document.body.appendChild(element)
    else
        document.body.insertBefore(element, document.getElementsByTagName("button")[0])
}

function addNewLast(e){
    if(e.target.value !== ""){
        addNewNode(true, {}, true)
        e.target.removeEventListener("change", addNewLast)
        e.target.addEventListener("change", removeNode)
    }
}
function removeNode(e){
    if(e.target.value === "")
        document.body.removeChild(e.target.parentNode.parentNode)
}

function submit(){
    document.getElementsByTagName("p")[0].innerText = ""
    const input = document.getElementsByClassName("playlistEl")
    const daata = []
    for(const el of input){
        if(el.nextSibling === document.getElementsByTagName("button")[0])
            break
        const ID = el.getElementsByClassName("ytIdInput")[0].value
        let plS = el.getElementsByTagName("select")[0].value
        let optionValues = [...el.getElementsByTagName("select")[0].options].map(o => o.value)
        let nieuw = false
        if(plS === "NIEUWE PLAYLIST") {
            plS = el.getElementsByTagName("input")[el.getElementsByTagName("input").length-1].value
            if(!optionValues.includes(plS))
                nieuw = true
        }
        if(ID.length!==34 || plS==="")
            return invalid()
        else
            daata.push({ID, plS, nieuw})
    }

    const IDs = []
    const plS = []
    for (const el of daata){
        IDs.push(el.ID)
        plS.push(el.plS)
    }
    if((new Set(IDs)).size !== IDs.length || (new Set(plS).size !== plS.length))       // duplicate yt id or jf name
        return invalid()

    let xhr = new XMLHttpRequest();
    xhr.open('POST', '/ytconfig');
    xhr.setRequestHeader('content-type', 'application/json');

    const inputEl = document.getElementsByTagName("input")
    for (const el of inputEl)
        el.disabled = true
    const selectEl = document.getElementsByTagName("select")
    for (const el of selectEl)
        el.disabled = true

    xhr.onload = function () {
        console.log(xhr)
        if(xhr.responseText === "duplicates")
            return invalid()
        else
            location.reload()
    }
    xhr.send(JSON.stringify(daata));
}

function invalid(){
    document.getElementsByTagName("p")[0].innerText = "gelieve geldige data in te voeren"
}