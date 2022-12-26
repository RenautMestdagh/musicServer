const express = require('express');
const router = express.Router();

const redirectEdit = (req, res, next) =>{
  if(req.session.userId)
    return res.redirect('/')
  next()
}

router.get("/", redirectEdit, (req,res)=>{
  res.render('login', {title: 'Playlist config login'});
})

router.post("/", redirectEdit, (req, res) => {
  const pass = req.body.password;
  if (pass === process.env.EDITPASS) {
    req.session.userId = 1
    return res.send("K")
  }
  return res.send('fout')
})

module.exports = router;