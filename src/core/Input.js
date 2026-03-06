export class Input {
  constructor() {
    this.keys = {};
    this.mouse = {
      left: false,
      right: false,
      leftPressed: false,
      rightPressed: false,
    };

    // Keyboard
    window.addEventListener("keydown", e => {
      this.keys[e.code] = true;
    });

    window.addEventListener("keyup", e => {
      this.keys[e.code] = false;
    });

    // Mouse buttons
    window.addEventListener("mousedown", e => {
      if (e.button === 0 && !this.mouse.left) {
        this.mouse.left = true;
        this.mouse.leftPressed = true; // single-frame trigger
      }
      if (e.button === 2 && !this.mouse.right) {
        this.mouse.right = true;
        this.mouse.rightPressed = true;
      }
    });

    window.addEventListener("mouseup", e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });

    // Disable right-click menu
    window.addEventListener("contextmenu", e => e.preventDefault());
  }

  /** Call once per frame */
  update() {
    this.mouse.leftPressed = false;
    this.mouse.rightPressed = false;
  }
}
