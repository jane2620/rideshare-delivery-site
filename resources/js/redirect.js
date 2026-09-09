getIsDesktop = () => {
    let check = false;
    (function (a) { if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0, 4))) check = true; })(navigator.userAgent || navigator.vendor || window.opera);
    return !check;
};

getBrowserIsChromeOrEdgeDesktop = () => {
    try {
        const userAgent = navigator.userAgent;

        let browser = "unknown";

        // Detect browser name
        browser = (/ucbrowser/i).test(userAgent) ? 'UCBrowser' : browser;
        browser = (/edg/i).test(userAgent) ? 'Edge' : browser;
        browser = (/googlebot/i).test(userAgent) ? 'GoogleBot' : browser;
        browser = (/chromium/i).test(userAgent) ? 'Chromium' : browser;
        browser = (/firefox|fxios/i).test(userAgent) && !(/seamonkey/i).test(userAgent) ? 'Firefox' : browser;
        browser = (/; msie|trident/i).test(userAgent) && !(/ucbrowser/i).test(userAgent) ? 'IE' : browser;
        browser = (/chrome|crios/i).test(userAgent) && !(/opr|opera|chromium|edg|ucbrowser|googlebot/i).test(userAgent) ? 'Chrome' : browser;;
        browser = (/safari/i).test(userAgent) && !(/chromium|edg|ucbrowser|chrome|crios|opr|opera|fxios|firefox/i).test(userAgent) ? 'Safari' : browser;
        browser = (/opr|opera/i).test(userAgent) ? 'Opera' : browser;

        if (getIsDesktop() && (browser == "Edge" || browser == "Chrome")) {
            return true;
        } else return false;
    } catch (error) {
        // Do nothing
    }
    return false;
}



function getIOSVersion() {
    const ua = navigator.userAgent;

    // Match iOS pattern
    const match = ua.match(/OS (\d+)_(\d+)_?(\d+)?/);

    if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        const patch = parseInt(match[3] || 0, 10);

        return { major, minor, patch };
    }
    return null; // Not iOS
}

getBrowserIsSafariMobileVersion = (treatmentCondition) => {
    try {
        const userAgent = navigator.userAgent;

        if (userAgent.match(/iPad/i)) {
            return false;
        }
        if (!!userAgent.match(/CriOS/i) || !!userAgent.match(/Brave/i) || !!userAgent.match(/Ddg/i) || !!userAgent.match(/FxiOS/i) || !!userAgent.match(/EdgiOS/i)) {
            return false;
        }

        if (!!userAgent.match(/WebKit/i) && !!userAgent.match(/iPhone/i)) {
            if (getIOSVersion()['major'] >= 18) {
                if (treatmentCondition >= 12 && getIOSVersion()['minor'] >= 4) {
                    return true;
                }
                if (treatmentCondition < 12 && getIOSVersion()['minor'] >= 2) {
                    return true;
                }
            }
            return false;
        } else {
            return false;
        }

    } catch (error) {
        // Do nothing
    }
    return false;
}

// 'initial' or 'followup'
const studyPhase = (new URLSearchParams(window.location.search)).get("STUDY_PHASE");
const treatmentCondition = parseInt((new URLSearchParams(window.location.search)).get("TC"), 10);

(async () => {


    try {
        const prolificId = (new URLSearchParams(window.location.search)).get("PROLIFIC_PID");

        if ((treatmentCondition <= 6 && !getBrowserIsChromeOrEdgeDesktop()) || (treatmentCondition >= 7 && !getBrowserIsSafariMobileVersion(treatmentCondition))) {
            const url = "https://n97rmes9xl.execute-api.us-east-2.amazonaws.com/deployed";
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "studyPhase": studyPhase,
                    "prolificId": prolificId,
                    "treatmentCondition": treatmentCondition,
                    "studyPhase": studyPhase,
                })
            });
            // Incompatible device return code
            window.location.href = "https://app.prolific.com/submissions/complete?cc=C13MC4S5";
        } else {
            if (studyPhase == "initial") {
                if (treatmentCondition == 2) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_7NSBmXpjrnaQ0h8?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 3) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_3UaZUKjbxXfAJHU?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 4) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_8uE04R6xR2IjFlA?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 5) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_5dq2kczZf3KV16m?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 6) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_8GHUGkocVjGXeHY?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 7) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_3Xbb1tCAmt8iY7k?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 8) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_cS9JvLHpCqC5kGi?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 9) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_eWmbCMJmHg3ZcX4?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 10) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_bQIBq4toCpJ2X1Y?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 11) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_06by0ICd7H2MZxk?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 12) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_cDgJG6vIueTJoqi?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 13) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_8iH3gSbHLEq3ZfE?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 14) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_b1Nnm4y652pCmnY?PROLIFIC_PID=${prolificId}`;
                } else if (treatmentCondition == 15) {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_e8uJJohSMHshzh4?PROLIFIC_PID=${prolificId}`;
                } else {
                    window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_cM7tV4GeFJF5YiO?PROLIFIC_PID=${prolificId}`;
                }
            } else {
                window.location.href = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_9ZXVhOGZ4TUQRpk?PROLIFIC_PID=${prolificId}`;
            }
        }
    } catch (error) {
        // Incompatible device return code
        window.location.href = "https://app.prolific.com/submissions/complete?cc=C13MC4S5";
    }
})();
