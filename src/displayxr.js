// DisplayXR glasses-free 3D (inline-3d web SDK).
//
// In the DisplayXR Browser on a spatial display, the game canvas becomes a woven 3D window: the
// runtime hands us one view per eye each frame and we render the scene into the two halves of a
// double-width canvas. Everywhere else createInline3D() reports `supported: false` and the game
// keeps its ordinary 2D loop (with bloom).
//
// Rig: the player flies through a world, so this is a CAMERA rig with the attach pattern (eye
// cameras parented under the chase camera, so stereo never trails the follow camera by a frame).
// Convergence is the chase distance to the plane, which keeps the plane on the glass while the
// valley recedes behind it and coins/rings swoop out toward the viewer. The eye separation is
// sized from the SDK's comfort maths for what is actually on screen.
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera, cameraRigFromCamera } from '@displayxr/inline3d/three';
import { cameraRigComfortFactor } from '@displayxr/inline3d/depth';

export async function startDisplayXR({ THREE, renderer, scene, camera, canvas, step, convergence, onLost }) {
  let wall;
  try {
    wall = await createInline3D({ lazy: false });
  } catch (err) {
    console.info('[DisplayXR] not available:', err?.message || err);
    return null;
  }
  if (!wall || !wall.supported) return null;

  const ctl = { active: false, wall, handle: null };
  scene.add(camera);
  const eyes = [new EyeCamera(THREE), new EyeCamera(THREE)];
  for (const e of eyes) camera.add(e.camera);
  const rig = {};
  const good = [0, 1].map(() => ({ proj: new Float32Array(16), pose: new Float32Array(16), x: 0, y: 0, width: 0, height: 0 }));
  let haveGood = false, metrics = null, ipd = 1, conv = convergence(), lastNear = 0, lastFar = 0;

  const sizeSBS = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    camera.aspect = w / h; camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix();
    if (canvas.width === w * 2 && canvas.height === h) return;
    renderer.setSize(w * 2, h, false);
    replay();
  };

  const rigParams = () => {
    // ease convergence so a camera move never snaps the scene through the glass
    conv += (convergence() - conv) * 0.08;
    const tileH = metrics?.canvasSizeM?.[1] || 0.2;
    const viewerM = metrics?.nominalViewerM || 0.6;
    // nearest content: terrain/coins just in front of the plane; farthest that matters: the fogged valley
    const zNear = Math.max(2.5, conv * 0.55);
    const f = cameraRigComfortFactor({ zNear, zFar: conv + 90, convergence: conv, verticalFov: THREE.MathUtils.degToRad(camera.fov), aspect: camera.aspect, tileHeightM: tileH, viewerM });
    const maxByRule = (0.9 * conv) / viewerM; // ipd x m2v x (1/conv) x N <= 0.9
    const want = Math.max(1, Math.min(Number.isFinite(f) ? f * 0.85 : maxByRule, maxByRule));
    ipd += (want - ipd) * 0.08;
    return { convergence: conv, ipd };
  };

  const pushRig = () => {
    const p = rigParams();
    ctl.handle.setViewRig(cameraRigFromCamera(THREE, camera, { convergence: p.convergence, ipdFactor: p.ipd, attach: true, out: rig }));
  };

  function replay() {
    if (!ctl.active) return;
    renderer.setScissorTest(false);
    renderer.clear();
    if (!haveGood) return;
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const g = good[i];
      renderer.setViewport(g.x, g.y, g.width, g.height);
      renderer.setScissor(g.x, g.y, g.width, g.height);
      eyes[i].setLocalFromMatrices(g.proj, g.pose);
      renderer.render(scene, eyes[i].camera);
    }
    renderer.setScissorTest(false);
  }

  function onFrame(views, layer) {
    step();
    try { pushRig(); } catch (e) { /* session tearing down */ }
    if (camera.near !== lastNear || camera.far !== lastFar) {
      try { wall.session.updateRenderState({ depthNear: camera.near, depthFar: camera.far }); lastNear = camera.near; lastFar = camera.far; } catch (e) { /* ignore */ }
    }
    if (!views || views.length < 2 || !layer) return replay();
    const vps = views.map(v => layer.getViewport(v));
    if (vps.some(vp => !vp || vp.width <= 0 || vp.height <= 0)) return replay();
    scene.updateMatrixWorld();
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const vp = vps[i], g = good[i];
      renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
      renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
      eyes[i].setLocalFromView(views[i]);
      renderer.render(scene, eyes[i].camera);
      g.proj.set(views[i].projectionMatrix);
      g.pose.set(views[i].transform.matrix);
      g.x = vp.x; g.y = vp.y; g.width = vp.width; g.height = vp.height;
    }
    renderer.setScissorTest(false);
    haveGood = true;
  }

  // Woven path: pixel ratio 1 (viewports are backing-store pixels), manual clears, no XR manager.
  const prev = { pr: renderer.getPixelRatio(), autoClear: renderer.autoClear };
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  renderer.xr.enabled = false;
  ctl.active = true;
  sizeSBS();
  const restore = () => { ctl.active = false; renderer.autoClear = prev.autoClear; renderer.setPixelRatio(prev.pr); renderer.setScissorTest(false); };
  try {
    ctl.handle = wall.addScene(canvas, onFrame, {
      viewRig: cameraRigFromCamera(THREE, camera, { convergence: conv, attach: true, out: rig }),
      onResize: () => sizeSBS(),
      onLayerLost: () => { restore(); onLost?.(); }, // back to one flat view, drawn by the 2D loop
    });
  } catch (err) {
    console.warn('[DisplayXR] addScene failed, staying in 2D:', err);
    restore();
    return null;
  }
  const refreshMetrics = () => ctl.handle.displayMetrics?.().then(m => { metrics = m; }).catch(() => {});
  refreshMetrics();
  window.addEventListener('resize', refreshMetrics);
  return ctl;
}
