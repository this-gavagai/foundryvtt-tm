// touch tweaks
export function setupTouch() {
  console.log('TABLEMATE: touch tweaks')
  const ZOOM_SPEED = 0.5
  const PAN_SPEED = 12
  const SMOOTH_LENGTH = 30
  const screen = document.querySelector('canvas#board')

  const hammer = new Hammer(screen)
  const pinch = hammer.get('pinch').set({ enable: true, threshold: 0 })
  const pan = hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL, pointers: 2, threshold: 0 })
  pinch.recognizeWith(pan)

  hammer.on('pinchstart', pinchStart)
  hammer.on('pinchend', pinchEnd)
  hammer.on('pan', panHandler)
  hammer.on('pinch', pinchHandler)

  // const reload = new Hammer.Press({ pointers: 4 })
  // reload.on(() => {
  //   location.reload()
  // })
  // hammer.add(reload)

  let base_scale = 1
  let scale_series = new Array(SMOOTH_LENGTH).fill(1)
  function getScale(ev) {
    base_scale = canvas.stage.scale.x
  }
  function pinchStart(ev) {
    console.log('pinch start')
    getScale(ev)
    // pinchStarted = true
  }
  function pinchEnd(ev) {
    console.log('pinch end')
    scale_series = new Array(SMOOTH_LENGTH).fill(1)
    // pinchStarted = false
  }

  function pinchHandler(ev) {
    canvas.controls.select.active = false
    scale_series.push(ev.scale)
    const smoothed_scale = scale_series
      .slice(SMOOTH_LENGTH * -1)
      .reduce((acc, c, i, a) => acc + c / a.length, 0)
    console.log(ev.scale, smoothed_scale)
    canvas.animatePan({
      scale: base_scale * Math.pow(smoothed_scale, ZOOM_SPEED),
      duration: 50
    })
  }
  function panHandler(ev) {
    canvas.controls.select.active = false
    // canvas.animatePan({
    canvas.pan({
      x: canvas.stage.pivot.x - (ev.velocityX * PAN_SPEED) / canvas.stage.scale.x,
      y: canvas.stage.pivot.y - (ev.velocityY * PAN_SPEED) / canvas.stage.scale.x
      // duration: 50
    })
  }

  canvas.tokens.addEventListener('pointerup', (e) => {
    console.log(e)
    if (e.pointerType === 'mouse') return
    canvas.tokens.children.forEach((c) => {
      c.children.forEach((t) => {
        try {
          if (t.interactionState) t.dispatchEvent(e)
        } catch (err) {
          console.log(e)
          console.log(err)
        }
      })
    })
  })
}
