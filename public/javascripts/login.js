function togglevis() {
    eye = document.getElementById("eye")
    eye.classList.toggle("fa-eye-slash");

    input = document.getElementById("password")
    if (input.type === "password") {
        input.type = "text";
    } else {
        input.type = "password";
    }
}

window.onload = function () {
    document.querySelector("form").onsubmit = submitted
}

document.getElementById("eye").onclick = function () {
    togglevis();
}


function submitted(event) {
    event.preventDefault();

    let pass = document.getElementById('password');
    let submit = document.getElementById('submit');

    submit.style.opacity = '0.4';
    submit.style.pointerEvents = 'none';
    submit.style.backgroundColor = '#ff5e5e';

    let data = {
        password: pass.value
    }

    let xhr = new XMLHttpRequest();
    xhr.open('POST', '/ytconfig/login');
    xhr.setRequestHeader('content-type', 'application/json');

    xhr.onload = function () {

        submit.style.opacity = null;
        submit.style.pointerEvents = null;
        submit.style.backgroundColor = null;

        if (xhr.responseText === 'fout') {
            pass.value = ''
            document.getElementById('passNCorrect').style.display = 'unset'
        } else {
            window.location = "/ytconfig"
        }
    }

    xhr.send(JSON.stringify(data));
}