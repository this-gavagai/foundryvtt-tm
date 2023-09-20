Hooks.on('init', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  //   for (u in game.data.users) {
  //     console.log('TABLEMATE init:', u)
  //   }
  //   console.log('TABLEMATE init:', game.userId)
  //   console.log('TABLEMATE init:', game.data.users)
  console.log('TABLEMATE init:', user)
  //   console.log('TABLEMATE init:', user.name)
  //   console.log('TABLEMATE init:', '#########')
  if (user.name.match('Sheet')) {
    window.location = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
  }
  //   window.history.pushState(null, '', '/game')
})

// Hooks.on('setup', function () {
//   console.log('TABLEMATE: checking userlogin for tablemate')
//   console.log('TABLEMATE:', game.userId)
//   console.log('TABLEMATE:', game)
//   if (game.user.name.match('Sheet')) {
//     window.location = window.location.origin + '/modules/tablemate/index.html'
//   }
// })
