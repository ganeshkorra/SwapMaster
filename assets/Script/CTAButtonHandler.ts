import { _decorator, Component, AudioSource, find, CCString, sys, tween, easing } from 'cc';
import { Analytics, analyticsEvents } from './Analytics';

const { ccclass, property } = _decorator;

@ccclass('CTAButtonHandler')
export class CTAButtonHandler extends Component {
    
    @property({
        type: CCString,
        tooltip: 'Default Android Play Store URL'
    })
    public androidStoreUrl: string = "https://play.google.com/store/apps/details?id=com.meemeegames.categorysort";

    @property({
        type: CCString,
        tooltip: 'Default iOS App Store URL'
    })
    public iosStoreUrl: string = "https://apps.apple.com/in/app/category-sort/id6758512068";

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
            // MRAID not present; fall back silently to other click handlers
        }
    }

    private onMraidReady(): void {
        this.isMraidReady = true;
    }

    private swingTween: any = null;

    onEnable() {
        this.startSwingAnimation();
    }

    onDisable() {
        if (this.swingTween) {
            this.swingTween.stop();
            this.swingTween = null;
        }
    }

    private startSwingAnimation(): void {
        if (this.swingTween) {
            this.swingTween.stop();
        }

        this.swingTween = tween(this.node)
            .to(1, { angle: 6 }, { easing: easing.quadInOut })
            .to(1, { angle: -6 }, { easing: easing.quadInOut })
            .union()
            .repeatForever()
            .start();
    }

    /**
     * Helper to get the correct URL based on Device OS
     */
    private getTargetStoreUrl(): string {
        if (sys.os === sys.OS.IOS) {
            return this.iosStoreUrl;
        } else {
            return this.androidStoreUrl;
        }
    }

    /**
     * Linked to the CTA button's click event in the Cocos Inspector
     */
    public onStoreButtonClicked(): void {
        const targetUrl = this.getTargetStoreUrl();

        // Fire CTA_CLICKED event
        if (Analytics.instance) {
            Analytics.instance.dispatchEvent(analyticsEvents.CTA_CLICKED);
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
            exitApi.exit();
            return;
        }

        // 3. Super HTML's Google wrapper also routes download() to ExitApi.exit().
        if (superHtml && typeof superHtml.download === "function") {
            superHtml.download(targetUrl);
            return;
        }

        // 4. Redirect using MRAID if available
        if (mraid && typeof mraid.open === "function") {
            mraid.open(targetUrl);
        } else {
            // Browser fallback
            adWindow.open(targetUrl, "_blank");
        }
    }
}
