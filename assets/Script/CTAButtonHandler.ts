import { _decorator, Component, AudioSource, find, CCString, sys } from 'cc';
import { Analytics, analyticsEvents } from './Analytics';

const { ccclass, property } = _decorator;

@ccclass('CTAButtonHandler')
export class CTAButtonHandler extends Component {
    
    @property({
        type: CCString,
        tooltip: 'Default Android Play Store URL'
    })
    public androidStoreUrl: string = "";

    @property({
        type: CCString,
        tooltip: 'Default iOS App Store URL'
    })
    public iosStoreUrl: string = "https://apps.apple.com/us/app/swap-master-connect-puzzle/id6779528962";

    private isMraidReady: boolean = false;

    onLoad() {
        const adWindow = globalThis as any;
        const mraid = adWindow.mraid;

        // Check for MRAID environment. Google builds usually use ExitApi instead.
        if (mraid) {
            if (mraid.getState && mraid.getState() === 'loading') {
                mraid.addEventListener('ready', this.onMraidReady.bind(this));
            } else {
                this.onMraidReady();
            }
        } else {
            console.log("MRAID library not found. Waiting for Google ExitApi or browser fallback.");
        }
    }

    private onMraidReady(): void {
        this.isMraidReady = true;
    }

    /**
     * Helper to get the correct URL based on Device OS
     */
    private getTargetStoreUrl(): string {
        if (sys.os === sys.OS.IOS) {
            console.log("Device detected: iOS");
            return this.iosStoreUrl;
        } else {
            // Default to Android for Android devices, Desktop browsers, and others
            console.log("Device detected: Android/Other");
            return this.androidStoreUrl;
        }
    }

    /**
     * Linked to the CTA button's click event in the Cocos Inspector
     */
    public onStoreButtonClicked(): void {
        const targetUrl = this.getTargetStoreUrl();
        console.log("CTA Triggered. Target URL:", targetUrl);

        // Fire CTA_CLICKED event
        if (Analytics.instance) {
            Analytics.instance.dispatchEvent(analyticsEvents.CTA_CLICKED);
            console.log("[Analytics] CTA_CLICKED event fired");
        }

        // 1. Stop audio before redirecting (Technical requirement)
        const mainAudio =
            find("Canvas-001/GameCamera")?.getComponent(AudioSource) ||
            find("Canvas/Camera")?.getComponent(AudioSource);
        if (mainAudio) {
            mainAudio.stop();
        }

        const adWindow = globalThis as any;
        const exitApi = adWindow.ExitApi;
        const superHtml = adWindow.super_html;
        const mraid = adWindow.mraid;

        // 2. Google playable ads require ExitApi.exit() for clickthroughs.
        if (exitApi && typeof exitApi.exit === "function") {
            console.log("Calling Google ExitApi.exit()");
            exitApi.exit();
            return;
        }

        // 3. Super HTML's Google wrapper also routes download() to ExitApi.exit().
        if (superHtml && typeof superHtml.download === "function") {
            console.log("Calling super_html.download()");
            superHtml.download(targetUrl);
            return;
        }

        // 4. Redirect using MRAID if available
        if (mraid && typeof mraid.open === "function") {
            console.log("Calling mraid.open()");
            mraid.open(targetUrl);
        } 
        // 5. Browser fallback for local/custom environments that do not expose an ad SDK.
        else {
            console.log("No ad click API available. Calling window.open()");
            adWindow.open(targetUrl, "_blank");
        }
    }
}
