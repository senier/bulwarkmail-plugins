// DMARC reports: shows a DMARC aggregate report mailed to you as a summary bar
// above the message, with the per-source table one click away, in place.
// Everything runs in the sandbox on the attachment the message already has.
// Only the optional reverse-DNS setting sends anything (the sending addresses,
// to the DNS-over-HTTPS resolver the user picks). Logic lives in ./lib (plain
// modules, unit-tested).

import * as React from 'react';
import host from '@plugin-host';
import { shouldShow } from './lib/detect.js';
import { makeReportBanner } from './ui/banner.js';

export default {
  slots: {
    'email-banner': { component: makeReportBanner(React, host), shouldShow },
  },
};
