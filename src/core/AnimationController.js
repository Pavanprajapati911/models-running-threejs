import { LoopRepeat, LoopOnce } from "three";

export class AnimationController {
  constructor(mixer, actions) {
    this.mixer = mixer;
    this.actions = actions;
    this.current = null;
  }

  play(name, loop = true) {
    if (this.current === name) return;

    const next = this.actions[name];
    if (!next) return;

    if (this.current) {
      this.actions[this.current].fadeOut(0.2);
    }

    next.reset();
    next.setLoop(loop ? LoopRepeat : LoopOnce);
    next.clampWhenFinished = true;
    next.fadeIn(0.2).play();

    this.current = name;
  }

  update(dt) {
    if (this.mixer) {
      this.mixer.update(dt);
    }
  }
}
