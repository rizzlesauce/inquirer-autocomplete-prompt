// @flow

/**
 * `autocomplete` type prompt
 */

var chalk = require('chalk');
var cliCursor = require('cli-cursor');
var figures = require('figures');
var Base = require('inquirer/lib/prompts/base');
var Choices = require('inquirer/lib/objects/choices');
var observe = require('inquirer/lib/utils/events');
var utils = require('inquirer/lib/utils/readline');
var Paginator = require('inquirer/lib/utils/paginator');
var runAsync = require('run-async');
var { takeWhile } = require('rxjs/operators');

class AutocompletePrompt extends Base {
  constructor(
    questions /*: Array<any> */,
    rl /*: readline$Interface */,
    answers /*: Array<any> */
  ) {
    super(questions, rl, answers);

    if (!this.opt.source) {
      this.throwParamError('source');
    }

    this.currentChoices = [];

    this.firstRender = true;
    this.selected = 0;

    // Make sure no default is set (so it won't be printed)
    this.opt.default = null;

    this.opt.showAutoTrail = this.opt.suggestOnly && this.opt.showAutoTrail;

    this.paginator = new Paginator();
    this.transformChoice = this.opt.transformChoice || (option => option);
  }

  /**
   * Start the Inquiry session
   * @param  {Function} cb      Callback when prompt is done
   * @return {this}
   */
  _run(cb /*: Function */) /*: this*/ {
    this.done = cb;

    if (this.rl.history instanceof Array) {
      this.rl.history = [];
    }

    var events = observe(this.rl);

    const dontHaveAnswer = () => !this.answer;

    events.line
      .pipe(takeWhile(dontHaveAnswer))
      .forEach(this.onSubmit.bind(this));
    events.keypress
      .pipe(takeWhile(dontHaveAnswer))
      .forEach(this.onKeypress.bind(this));

    if (this.opt.showAutoTrail) {
      this.cursorPos = 0;
      cliCursor.hide();
    }

    // Call once at init
    this.search(undefined);

    return this;
  }

  /**
   * Render the prompt to screen
   * @return {undefined}
   */
  render(error /*: ?string */) {
    // Render question
    var content = this.getQuestion();
    var bottomContent = '';

    const renderLine = (selectedChoice /*: ?string */) => {
      if (this.opt.showAutoTrail) {
        const cursorPos = this.cursorPos;
        const line = this.rl.line;
        let autoTrail = '';
        if (this.opt.showAutoTrail && selectedChoice) {
          const transformedChoice = this.transformChoice(selectedChoice);
          for (let i = 0; i < line.length; ++i) {
            const prefix = line.substr(i);
            if (transformedChoice.startsWith(prefix)) {
              autoTrail = transformedChoice.substr(prefix.length);
              break;
            }
          }
        }
        for (let i = 0; i <= (line.length + autoTrail.length + 1); ++i) {
          let char = ' ';
          if (i < line.length) {
            char = line.charAt(i);
          } else if (autoTrail) {
            const autoTrailI = i - line.length;
            if (autoTrailI < autoTrail.length) {
              char = autoTrail.charAt(autoTrailI);
              if (i !== cursorPos) {
                char = chalk.dim(char);
              }
            }
          }
          if (i === cursorPos) {
            char = chalk.inverse(char);
          }
          content += char;
        }
      } else {
        content += this.rl.line;
      }
    };

    if (this.firstRender) {
      const suggestText = 'suggestText' in this.opt ? this.opt.suggestText :
        `(Use arrow keys or type to search${this.opt.suggestOnly ? ', tab to autocomplete' : ''})`;
      if (suggestText) {
        content += chalk.dim(suggestText);
      }
    }
    // Render choices or answer depending on the state
    if (this.status === 'answered') {
      content += chalk.cyan(this.shortAnswer || this.answerName || this.answer);
    } else if (this.searching) {
      renderLine();
      bottomContent += '  ' + chalk.dim('Searching...');
    } else if (this.currentChoices.length) {
      const {
        choicesStr,
        selectedChoice,
      } = listRender(this.currentChoices, this.selected, this.opt.styleSelected);
      renderLine(selectedChoice);
      var indexPosition = this.selected;
      var realIndexPosition = 0;
      this.currentChoices.choices.every((choice, index) => {
        if (index > indexPosition) {
          return false;
        }
        realIndexPosition += choice.name.split('\n').length;
        return true;
      });
      bottomContent += this.paginator.paginate(
        choicesStr,
        realIndexPosition,
        this.opt.pageSize
      );
    } else {
      renderLine();
      const noResultsText = 'noResultsText' in this.opt ? this.opt.noResultsText : 'No results...';
      if (noResultsText) {
        bottomContent += '  ' + chalk.yellow(noResultsText);
      }
    }

    if (error) {
      bottomContent += '\n' + chalk.red('>> ') + error;
    }

    this.firstRender = false;

    this.screen.render(content, bottomContent);
  }

  /**
   * When user press `enter` key
   */
  onSubmit(line /* : string */) {
    if (!this.opt.suggestOnly) {
      line = this.transformChoice(line);
    }
    if (typeof this.opt.validate === 'function' && this.opt.suggestOnly) {
      var validationResult = this.opt.validate(line);

      const checkValidationResult = validationResult => {
        if (validationResult !== true) {
          this.render(
            validationResult || 'Enter something, tab to autocomplete!'
          );
        } else {
          this.continueOnSubmitAfterValidation(line);
        }
      };

      if (isPromise(validationResult)) {
        validationResult.then(checkValidationResult);
      } else {
        checkValidationResult(validationResult);
      }
    } else {
      this.continueOnSubmitAfterValidation(line);
    }
  }

  continueOnSubmitAfterValidation(line /* : string */) {
    var choice = {};
    if (this.currentChoices.length <= this.selected && !this.opt.suggestOnly) {
      this.rl.write(line);
      this.search(line);
      return;
    }

    if (this.opt.suggestOnly) {
      choice.value = line || this.rl.line;
      this.answer = line || this.rl.line;
      this.answerName = line || this.rl.line;
      this.shortAnswer = line || this.rl.line;
      this.rl.line = '';
    } else {
      choice = this.currentChoices.getChoice(this.selected);
      this.answer = choice.value;
      this.answerName = choice.name;
      this.shortAnswer = choice.short;
    }

    runAsync(this.opt.filter, (err, value) => {
      choice.value = value;
      this.answer = value;

      if (this.opt.suggestOnly) {
        this.shortAnswer = value;
      }

      this.status = 'answered';
      // Rerender prompt
      this.render();
      this.screen.done();
      if (this.opt.showAutoTrail) {
        cliCursor.show();
      }
      this.done(choice.value);
    })(choice.value);
  }

  search(searchTerm /* : ?string */) {
    var self = this;
    self.selected = 0;

    // Only render searching state after first time
    if (self.searchedOnce) {
      self.searching = true;
      self.currentChoices = new Choices([]);
      self.render(); // Now render current searching state
    } else {
      self.searchedOnce = true;
    }

    self.lastSearchTerm = searchTerm;
    var thisPromise = self.opt.source(self.answers, searchTerm);

    // Store this promise for check in the callback
    self.lastPromise = thisPromise;

    return thisPromise.then(function inner(choices) {
      // If another search is triggered before the current search finishes, don't set results
      if (thisPromise !== self.lastPromise) return;

      choices = new Choices(
        choices.filter(function(choice) {
          return choice.type !== 'separator';
        })
      );

      self.currentChoices = choices;
      self.searching = false;
      self.render();
    });
  }

  ensureSelectedInRange() {
    var selectedIndex = Math.min(this.selected, this.currentChoices.length); // Not above currentChoices length - 1
    this.selected = Math.max(selectedIndex, 0); // Not below 0
  }

  /**
   * When user type
   */

  onKeypress(e /* : {key: { name: string }, value: string} */) {
    var len;
    var keyName = (e.key && e.key.name) || undefined;

    if (keyName === 'tab' && this.opt.suggestOnly) {
      if (this.currentChoices.getChoice(this.selected)) {
        this.rl.clearLine();
        var autoCompleted = this.transformChoice(
            this.currentChoices.getChoice(this.selected).value);
        this.rl.write(autoCompleted);
        if (this.opt.showAutoTrail) {
          this.cursorPos = autoCompleted.length;
        }
        this.render();
        if (this.opt.searchOnAutocomplete) {
          this.search(autoCompleted);
        }
      }
    } else if (keyName === 'down') {
      len = this.currentChoices.length;
      this.selected = this.selected < len - 1 ? this.selected + 1 : 0;
      this.ensureSelectedInRange();
      this.render();
      utils.up(this.rl, 2);
    } else if (keyName === 'up') {
      len = this.currentChoices.length;
      this.selected = this.selected > 0 ? this.selected - 1 : len - 1;
      this.ensureSelectedInRange();
      this.render();
    } else {
      const changed = this.lastSearchTerm !== this.rl.line;
      if (this.opt.showAutoTrail) {
        if (keyName === 'left' || keyName === 'backspace') {
          if (this.cursorPos > 0) {
            --this.cursorPos;
          }
        } else if (keyName === 'right') {
          if (this.cursorPos < this.rl.line.length) {
            ++this.cursorPos;
          }
        } else if (keyName === 'delete') {
          // do nothing
        } else {
          ++this.cursorPos;
        }
      }
      this.render(); // Render input automatically
      // Only search if input have actually changed, not because of other keypresses
      if (changed) {
        this.search(this.rl.line); // Trigger new search
      }
    }
  }
}

/**
 * Function for rendering list choices
 * @param  {Number} pointer Position of the pointer
 * @return {String}         Rendered content
 */
function listRender(choices, pointer /*: string */, styleSelected /*: (text: string) => string */) /*: string */ {
  var output = '';
  var separatorOffset = 0;
  let selectedChoice = undefined;

  choices.forEach(function(choice, i) {
    if (choice.type === 'separator') {
      separatorOffset++;
      output += '  ' + choice + '\n';
      return;
    }

    var isSelected = i - separatorOffset === pointer;
    var line = (isSelected ? figures.pointer + ' ' : '  ') + choice.name;

    if (isSelected) {
      if (styleSelected) {
        line = styleSelected(line);
      } else {
        line = chalk.cyan(line);
      }
      selectedChoice = choice.name;
    }
    output += line + ' \n';
  });

  return {
    choicesStr: output.replace(/\n$/, ''),
    selectedChoice,
  };
}

function isPromise(value) {
  return typeof value === 'object' && typeof value.then === 'function';
}

module.exports = AutocompletePrompt;
