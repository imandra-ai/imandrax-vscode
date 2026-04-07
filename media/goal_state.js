// @ts-check

// This script is run within the webview itself
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  class GoalStateEditor {
    constructor( /** @type {HTMLElement} */ parent) {
      this.ready = false;
      this.focusLockAnchor = undefined;
      this._initElements(parent);
      this.hover_timeout = undefined;
    }

    _initElements(/** @type {HTMLElement} */ parent) {
      if (!parent)
        return;

      this.wrapper = document.createElement('div');
      this.wrapper.style.position = 'relative';
      parent.append(this.wrapper);

      this.pos = document.createElement('div');
      this.wrapper.append(this.pos)

      // Create hover box element
      this.hoverBox = document.createElement('div');
      this.hoverBox.className = 'goal-state-hover-box';
      this.hoverBox.style.display = 'none';
      document.body.appendChild(this.hoverBox);

      parent.addEventListener('mousedown', () => {
        if (!this.ready) {
          return;
        }
      });

      document.body.addEventListener('mouseup', async () => {
        if (!this.ready) {
          return;
        }
      });

      parent.addEventListener('mousemove', e => {
        if (!this.ready) {
          return;
        }
      });
    }

    _setupHoverHandlers() {
      const hoverable = this.pos?.querySelectorAll('[data-hover], .hoverable');

      hoverable?.forEach(element => {
        element.addEventListener('mouseenter', (e) => {
          const hoverText = element.getAttribute('data-hover');
          if (this.hoverBox && hoverText) {
            this._updateHoverBox(hoverText, e);
          }
        });

        element.addEventListener('mouseleave', () => {
          if (this.hoverBox) {
            clearTimeout(this.hover_timeout);
            this.hover_timeout = setTimeout(() => {
              if (this.hoverBox && !this.hoverBox.matches(':hover'))
                this.hoverBox.style.display = 'none';
            }, 100);
          }
        });
      });

      document.querySelectorAll('.focus-lock-icon').forEach(a => {
        a.addEventListener('mouseenter', (e) => {
          let img = a.childNodes[0];
          img.style.opacity = 1.0;
        });
        a.addEventListener('mouseleave', (e) => {
          if (!this.focusLockAnchor) {
            let img = a.childNodes[0];
            img.style.opacity = 0.25;
          }
          else
            if (a.getAttribute('anchor') != this.focusLockAnchor) {
              let img = a.childNodes[0];
              img.style.opacity = 0.25;
            }
        });
      });
    }

    _lockFocus(/** @type {string | undefined} */ anchor, /** @type {Element | undefined} */ elem) {
      let setFocus = (/** @type {Element} */ e) => {
        let img = e.childNodes[0];
        img.classList.remove('codicon-unlock');
        img.classList.add('codicon-lock');
        img.style.opacity = 1.0;
        window.scrollTo({ top: e.offsetTop, left: 0, behavior: 'smooth' });
      };
      if (anchor) {
        document.querySelectorAll('.focus-lock-icon').forEach((/** @type {Element} */ a) => {
          let img = a.childNodes[0];
          img.classList.remove('codicon-lock');
          img.classList.add('codicon-unlock');
          img.style.opacity = 0.25;
        });
        this.focusLockAnchor = anchor;

        vscode.setState({ lockFocusAnchor: this.focusLockAnchor });
        vscode.postMessage({
          command: 'focus-lock-onto',
          arguments: { 'anchor': anchor }
        });

        if (elem)
          setFocus(elem);
        else {
          document.querySelectorAll('.focus-lock-icon').forEach((/** @type {Element} */ a) => {
            let anchor = a.getAttribute('anchor');
            if (anchor == this.focusLockAnchor)
              setFocus(a);
          })
        }
      }
    }

    _unlockFocus() {
      if (this.focusLockAnchor) {
        this.focusLockAnchor = undefined;
        vscode.setState({ lockFocusAnchor: this.focusLockAnchor });
        document.querySelectorAll('.focus-lock-icon').forEach((/** @type {Element} */ a) => {
          let img = a.childNodes[0];
          img.classList.remove('codicon-lock');
          img.classList.add('codicon-unlock');
          img.style.opacity = 0.25;
        });

        vscode.postMessage({
          command: 'focus-lock-onto',
          arguments: { 'anchor': undefined }
        });
      }
    }

    _setupEventHandlers() {
      document.querySelectorAll('.jump-to').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const args = a.getAttribute('arguments');
          if (args)
            vscode.postMessage({
              command: 'jump-to',
              arguments: JSON.parse(args)
            });
        });
      });
      document.querySelectorAll('.expandable').forEach(a => {
        a.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const args = a.getAttribute('arguments');
          if (args)
            vscode.postMessage({
              command: 'expand',
              arguments: JSON.parse(args)
            });
        });
      });
      document.querySelectorAll('.focus-lock-icon').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          let anchor = a.getAttribute('anchor')
          if (anchor) {
            if (this.focusLockAnchor == anchor)
              this._unlockFocus();
            else
              this._lockFocus(anchor, a)
            window.scrollTo({ top: a.offsetTop, left: 0, behavior: 'smooth' });
          }
        });
      });
      document.querySelectorAll('.identifier').forEach(a => {
        a.addEventListener('mouseenter', (e) => {
          if (e.ctrlKey)
            a.style.textDecoration = 'underline';
        });
        a.addEventListener('keydown', (e) => {
          if (e.ctrlKey)
            a.style.textDecoration = 'underline';
        });
        a.addEventListener('mouseleave', (e) => {
          a.style.textDecoration = 'none';
        });
        a.addEventListener('click', (e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            const name = a.getAttribute('name');
            if (name)
              vscode.postMessage({
                command: 'jump-to-declaration',
                arguments: { name: name }
              });
          }
        });
      });

      document.querySelectorAll('details').forEach(a => {
        a.addEventListener('click', (e) => {
          if (!a.open) {
            a.classList.add('loading');
            a.addEventListener('toggle', () => {
              a.classList.remove('loading');
            }, { once: true });
          }
        });
      });
    }

    _updateHoverBox(/** @type string */ hoverText, /** @type Event */ event) {
      const event_rect = event.target?.getBoundingClientRect();
      if (event_rect) {
        const offset = 4;
        let left = event_rect.left;
        let top = event_rect.top;

        clearTimeout(this.hover_timeout);
        this.hover_timeout = setTimeout(() => {
          if (this.hoverBox) {
            this.hoverBox.style.display = 'none';
            this.hoverBox.innerHTML = hoverText;

            this.hoverBox.style.display = 'block'
            const boxRect = this.hoverBox.getBoundingClientRect();

            if (left + boxRect.width > window.innerWidth) {
              left = window.innerWidth - boxRect.width - 10;
            }

            this.hoverBox.style.left = left + 'px';

            top = top - boxRect.height - offset;

            if (top < 0)
              top = 0;

            this.hoverBox.style.top = top + 'px';
          }
        },
          200);
      }
    }

    _redraw() {
    }

    async reset( /** @type {string} */ content) {
      this._redraw();
      if (this.pos && content)
        this.pos.innerHTML = content;
      if (this.hoverBox)
        this.hoverBox.style.display = 'none';
      this._setupHoverHandlers();
      this._setupEventHandlers();
      this.focusLockAnchor = vscode.getState()?.lockFocusAnchor;
      this._lockFocus(this.focusLockAnchor, undefined);
      this.ready = true;
    }

    async refocus() {
      this._lockFocus(this.focusLockAnchor, undefined);
    }

    onResize() {
      const code_like_element = document.querySelector('.code-like');
      if (code_like_element) {
        const width = this.pos?.getBoundingClientRect().width;
        const font_size = parseFloat(getComputedStyle(code_like_element).getPropertyValue('font-size'));
        vscode.postMessage({
          command: 'resize',
          arguments: { width: width, font_size: font_size }
        });
      }
      else console.log("no code_like");
    }
  }

  const editor = new GoalStateEditor(document.querySelector('.goal-state-content'));

  function debounce(/** @type () => void */ fn, /** @type number */ delay) {
    /** @type NodeJS.Timeout | undefined */
    let timer = undefined;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(editor, args), delay);
    };
  }

  window.addEventListener('resize', debounce(editor.onResize, 150));

  // Handle messages from the extension
  window.addEventListener('message', async e => {
    const { type, body, requestId } = e.data;
    // console.log(`JS Message: type=${type} body=${JSON.stringify(body)}`);
    switch (type) {
      case 'init':
        {
          if (body.untitled || !body.value)
            await editor.reset("<div style='code-like'>&#x25A0</div>");
          else
            await editor.reset(body.value);
          return;
        }
      case 'update':
        {
          editor.reset(body.content);
          return;
        }
      case 'refocus':
        {
          editor.refocus();
          return;
        }
    }
  });

  // Signal to VS Code that the webview is initialized.
  vscode.postMessage({ command: 'ready' });
}());