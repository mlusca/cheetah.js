### Schedule plugin for Cheetah.js

This plugin provides a simple way to schedule tasks in Cheetah.js.

### Installation

For install, run the command below:

```bash
bun install @cheetah.js/schedule
```

### Usage

Only add the plugin to the Cheetah.js instance:

```javascript
import {Cheetah} from '@cheetah.js/core';

new Cheetah().use(CheetahSchedule).listen();
```

### Schedule tasks

#### Example:

```javascript
import { Cheetah, Service, Get, Schedule } from '@cheetah.js/core';

@Service()
export class HomeController {
  @Schedule('* * * * * *')
  index() {
    return '';
  }
  
  @Interval(1000)
  index() {
    return '';
  }
  
  @Timeout(1000)
  index() {
    return '';
  } 
}