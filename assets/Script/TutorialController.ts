// FILE: /assets/Scripts/TutorialController.ts (Corrected and Safer)

import { _decorator, Component, Node, tween, v3, Vec3, Tween, SpriteFrame, Sprite, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('TutorialController')
export class TutorialController extends Component {
    @property({ type: Node, tooltip: 'The hand child node that will be animated.' })
    public handNode: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'The sprite for the idle/pointing hand.' })
    public idleHandSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'The sprite for the hand when it is clicked down.' })
    public clickHandSprite: SpriteFrame | null = null;

    private handTween: Tween<Node> | null = null;

    private getAnimatedHandNode(): Node | null {
        return this.handNode || this.node;
    }

    private getHandSprite(): Sprite | null {
        const animatedNode = this.getAnimatedHandNode();
        if (!animatedNode) {
            return null;
        }

        return animatedNode.getComponent(Sprite) || animatedNode.getComponentInChildren(Sprite) || null;
    }

    public playTutorial(startNode: Node, endNode: Node): void {
        const animatedNode = this.getAnimatedHandNode();
        if (!animatedNode || !this.idleHandSprite || !this.clickHandSprite) return;

        if (!startNode || !endNode || !startNode.isValid || !endNode.isValid) return;

        animatedNode.active = true;
        this.runAnimationLoop(startNode, endNode);
    }

    private findFirstUITransform(startNode: Node | null): UITransform | null {
        let current: Node | null = startNode;
        while (current) {
            const uiTransform = current.getComponent(UITransform);
            if (uiTransform) {
                return uiTransform;
            }
            current = current.parent;
        }

        return null;
    }

    public stopTutorial(): void {
        if (this.handTween) {
            this.handTween.stop();
            this.handTween = null;
        }

        const animatedNode = this.getAnimatedHandNode();
        if (animatedNode) {
            animatedNode.active = false;
        }
    }

    private runAnimationLoop(startNode: Node, endNode: Node): void {
        const animatedNode = this.getAnimatedHandNode();
        const handSprite = this.getHandSprite();
        if (!animatedNode || !handSprite) return;

        if (!startNode.isValid || !endNode.isValid) {
            this.stopTutorial();
            return;
        }

        const startPosition = this.getUIPosition(startNode);
        const endPosition = this.getUIPosition(endNode);

        if (!startPosition || !endPosition) {
            this.stopTutorial();
            return;
        }

        handSprite.spriteFrame = this.idleHandSprite;
        animatedNode.setPosition(startPosition);

        this.handTween = tween(animatedNode)
            .delay(0.5)
            .call(() => {
                handSprite.spriteFrame = this.clickHandSprite!;
            })
            .delay(0.15)
            .to(1.5, { position: endPosition }, { easing: 'sineInOut' })
            .call(() => {
                handSprite.spriteFrame = this.idleHandSprite!;
            })
            .delay(0.5)
            .call(() => {
                this.runAnimationLoop(startNode, endNode);
            })
            .start();
    }

    private getUIPosition(targetNode: Node): Vec3 | null {
        const animatedNode = this.getAnimatedHandNode();
        if (!animatedNode || !targetNode.isValid) return null;

        const targetUIT = this.findFirstUITransform(targetNode);
        if (!targetUIT) return null;

        const worldPos = targetNode.getWorldPosition(new Vec3());
        const worldBounds = targetUIT.getBoundingBoxToWorld();

        // Convert world position to the animated node's parent local space if possible.
        // `runAnimationLoop` uses `setPosition` (local) so returning world coords
        // makes the hand appear in the wrong place. When the animated node has
        // a parent with a UITransform, convert to that parent's local space.
        const parent = animatedNode.parent;
        if (parent) {
            const parentTransform = parent.getComponent(UITransform);
            if (parentTransform) {
                return parentTransform.convertToNodeSpaceAR(worldPos);
            }
        }

        // Fallback: return world position for callers that expect world coords.
        return worldPos;
    }

    public playClickTutorial(targetNode: Node): void {
        const animatedNode = this.getAnimatedHandNode();
        if (!animatedNode || !this.idleHandSprite || !this.clickHandSprite || !targetNode?.isValid) return;

        const targetPosition = this.getUIPosition(targetNode);
        if (!targetPosition) {
            this.stopTutorial();
            return;
        }

        animatedNode.active = true;
        this.runClickAnimationLoop(targetPosition);
    }

    public playAtWorldPosition(worldPosition: Vec3): void {
        const animatedNode = this.getAnimatedHandNode();
        if (!animatedNode || !this.idleHandSprite || !this.clickHandSprite) return;

        animatedNode.active = true;
        this.runClickAnimationLoop(worldPosition);
    }

    /**
     * Immediately set the animated hand node's world position. Useful for resets
     * before re-activating the tutorial so the hand doesn't briefly appear at
     * an old location.
     */
    public setHandWorldPosition(worldPosition: Vec3): void {
        const animatedNode = this.getAnimatedHandNode();
        if (!animatedNode) return;
        // Stop any tweens affecting the node to avoid conflicts
        try {
            Tween.stopAllByTarget(animatedNode);
        } catch (e) {
            // If Tween helper isn't available on this object, ignore.
        }
        animatedNode.setWorldPosition(worldPosition);
    }

    private runClickAnimationLoop(targetPosition: Vec3): void {
        const animatedNode = this.getAnimatedHandNode();
        const handSprite = this.getHandSprite();
        if (!animatedNode || !handSprite) {
            this.stopTutorial();
            return;
        }

        handSprite.spriteFrame = this.idleHandSprite;
        animatedNode.setWorldPosition(targetPosition);

        this.handTween = tween(animatedNode)
            .delay(0.5)
            .call(() => {
                handSprite.spriteFrame = this.clickHandSprite!;
                tween(animatedNode).by(0.15, { position: new Vec3(0, -10, 0) }).start();
            })
            .delay(0.3)
            .call(() => {
                handSprite.spriteFrame = this.idleHandSprite!;
                tween(animatedNode).by(0.15, { position: new Vec3(0, 10, 0) }).start();
            })
            .delay(0.5)
            .call(() => {
                this.runClickAnimationLoop(targetPosition);
            })
            .start();
    }
}