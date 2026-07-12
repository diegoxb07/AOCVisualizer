/* Mission Visualizer, report a problem / ask a question (the ! button in the top-right cluster).
   Part of index.html, split into modules so a failure in one file does not break the others.
   Same feature as in AOCQualityCheck: a subject + details form whose Send opens a prefilled
   Gmail compose addressed to diegoxiaobarbero@gmail.com (static page, no server; the address is
   shown in the form so the sender always knows where the report goes). */

    (function () {
        'use strict';

        const REPORT_EMAIL = 'diegoxiaobarbero@gmail.com';

        // form modal: subject + details, destination address shown right in the form
        const rm = document.createElement('div');
        rm.id = 'reportModal'; rm.className = 'modal-overlay';
        rm.innerHTML =
            '<div class="modal-card" style="max-width:560px">' +
              '<button id="reportClose" class="report-x" style="position:absolute;top:14px;right:14px" title="Close">✕</button>' +
              '<h2 class="text-ink text-lg font-bold border-b border-hairline pb-2">Report a Problem or Ask a Question</h2>' +
              '<div class="report-form" id="reportForm">' +
                '<label for="reportSubject">Subject</label>' +
                '<input type="text" id="reportSubject" autocomplete="off" />' +
                '<label for="reportBody">Details</label>' +
                '<textarea id="reportBody" rows="7"></textarea>' +
                '<div class="report-actions">' +
                  '<span class="report-note">Sends as an email to <b class="text-muted" style="font-weight:600">' + REPORT_EMAIL + '</b>. The loaded mission id is attached automatically; your draft is kept here until it is sent.</span>' +
                  '<button id="reportSend" type="button" class="report-btn" style="background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:700">Send</button>' +
                '</div>' +
              '</div>' +
            '</div>';
        document.body.appendChild(rm);
        // the redirect notice is its own small overlay stacked on top of the form (an are you
        // sure step), never replacing it. closing anything keeps the typed draft; only a
        // completed send clears it.
        const rc = document.createElement('div');
        rc.id = 'reportConfirm'; rc.className = 'modal-overlay'; rc.style.zIndex = '5100';
        rc.innerHTML =
            '<div class="modal-card" style="max-width:420px">' +
              '<p class="report-confirm-text">Clicking \'Send\' again will open Gmail with your report prefilled, addressed to ' + REPORT_EMAIL + '. Are you sure you want to do this?</p>' +
              '<div class="report-actions" style="justify-content:flex-end">' +
                '<button id="reportBack" type="button" class="report-btn">Back</button>' +
                // a real link, not a scripted navigation: a genuine user click is never popup-blocked
                '<a id="reportGmail" class="report-btn" href="https://mail.google.com/" target="_blank" rel="noopener" style="background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:700;text-decoration:none;display:inline-block">Send</a>' +
              '</div>' +
            '</div>';
        document.body.appendChild(rc);
        const rcClose = () => { rc.style.display = 'none'; };
        const rmClose = () => { rm.style.display = 'none'; rcClose(); };
        document.getElementById('reportClose').addEventListener('click', rmClose);
        rm.addEventListener('click', e => { if (e.target === rm) rmClose(); });
        rc.addEventListener('click', e => { if (e.target === rc) rcClose(); });
        // escape peels one layer at a time: the confirm first, then the form
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (rc.style.display === 'flex') rcClose();
            else if (rm.style.display === 'flex') rmClose();
        });
        // opening the confirm bakes the draft into the gmail link. the subject names the tool,
        // so reports are recognizable in the inbox.
        const reportDraft = () => {
            const subj = 'AOCVisualizer - ' + ((document.getElementById('reportSubject').value || '').trim() || 'feedback');
            const id = (typeof flightMetaData !== 'undefined' && flightMetaData.id && flightMetaData.id !== 'Unknown') ? flightMetaData.id : 'none loaded';
            return { subj: subj, body: (document.getElementById('reportBody').value || '') + '\n\nMission: ' + id + ' · Mission Visualizer' };
        };
        const reportClear = () => {
            document.getElementById('reportSubject').value = '';
            document.getElementById('reportBody').value = '';
            rmClose();
        };
        document.getElementById('reportSend').addEventListener('click', () => {
            const d = reportDraft();
            document.getElementById('reportGmail').href =
                'https://mail.google.com/mail/?view=cm&fs=1&to=' + REPORT_EMAIL + '&su=' + encodeURIComponent(d.subj) + '&body=' + encodeURIComponent(d.body);
            rc.style.display = 'flex';
        });
        document.getElementById('reportBack').addEventListener('click', rcClose);
        // gmail composes in a new tab; the delivered draft clears once it is handed over
        document.getElementById('reportGmail').addEventListener('click', () => setTimeout(reportClear, 80));
        const rb = document.getElementById('reportProblemBtn');
        if (rb) rb.onclick = () => { if (rm.style.display === 'flex') rmClose(); else rm.style.display = 'flex'; };
    })();
