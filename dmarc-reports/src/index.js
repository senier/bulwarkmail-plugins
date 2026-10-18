// DMARC reports: shows a DMARC aggregate report mailed to you as a summary bar
// above the message, with the per-source table one click away. Everything runs
// in the sandbox on the attachment the message already has; nothing is sent
// anywhere. Logic lives in ./lib (plain modules, unit-tested).

import * as React from 'react';
import host from '@plugin-host';
import { shouldShow } from './lib/detect.js';
import { makeReportBanner } from './ui/banner.js';
import { makeReportDialog } from './ui/dialog.js';

export default {
  slots: {
    'email-banner': { component: makeReportBanner(React, host), shouldShow },
    'plugin-dialog': { component: makeReportDialog(React, host) },
  },
};
