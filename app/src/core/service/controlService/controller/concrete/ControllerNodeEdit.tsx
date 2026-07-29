import { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { ControllerClass } from "@/core/service/controlService/controller/ControllerClass";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { UrlNode } from "@/core/stage/stageObject/entity/UrlNode";
import { ReferenceBlockNode } from "@/core/stage/stageObject/entity/ReferenceBlockNode";
import { LatexNode } from "@/core/stage/stageObject/entity/LatexNode";
import { isMac } from "@/utils/platform";
import { Vector } from "@graphif/data-structures";
import { open } from "@tauri-apps/plugin-shell";
import { MouseLocation } from "../../MouseLocation";
import { Renderer } from "@/core/render/canvas2d/renderer";
import LatexEditWindow from "@/sub/LatexEditWindow";
/**
 * 包含编辑节点文字，编辑详细信息等功能的控制器
 *
 * 当有节点编辑时，会把摄像机锁定住
 */
export class ControllerNodeEditClass extends ControllerClass {
  private detailClickStart?: { node: TextNode; viewLocation: Vector };

  constructor(protected readonly project: Project) {
    super(project);
  }

  mousedown = (event: MouseEvent) => {
    this.detailClickStart = undefined;
    if (event.button !== 0 || this.project.controller.camera.isPreGrabbingWhenSpace) return;

    const pressLocation = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));
    const clickedEntity = this.project.stageManager.findEntityByLocation(pressLocation);
    if (clickedEntity instanceof TextNode && clickedEntity.openDetailsOnClick) {
      this.detailClickStart = { node: clickedEntity, viewLocation: new Vector(event.clientX, event.clientY) };
    }
  };

  mouseDoubleClick = async (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    if (this.project.controller.camera.isPreGrabbingWhenSpace) {
      return;
    }

    const pressLocation = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));
    const clickedEntity = this.project.stageManager.findEntityByLocation(pressLocation);

    if (clickedEntity === null) {
      return;
    }

    if (clickedEntity instanceof TextNode && clickedEntity.openDetailsOnClick) {
      this.project.controllerUtils.editNodeDetails(clickedEntity);
      return;
    }

    if (this.project.controller.pressingKeySet.has(isMac ? "meta" : "control")) {
      this.project.controllerUtils.editNodeDetails(clickedEntity);
      return;
    }

    if (clickedEntity instanceof TextNode) {
      this.project.controllerUtils.editTextNode(clickedEntity, Settings.textNodeSelectAllWhenStartEditByMouseClick);
    } else if (clickedEntity instanceof LatexNode) {
      this.editLatexNode(clickedEntity);
    } else if (clickedEntity instanceof UrlNode) {
      const diffNodeLeftTopLocation = pressLocation.subtract(clickedEntity.rectangle.leftTop);
      if (diffNodeLeftTopLocation.y < UrlNode.titleHeight) {
        this.editUrlNodeTitle(clickedEntity);
      } else {
        // 跳转链接
        open(clickedEntity.url);
      }
    } else if (clickedEntity instanceof ReferenceBlockNode) {
      // 双击引用块跳转到源头
      clickedEntity.goToSource();
    }
  };

  mouseup = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    if (this.project.controller.camera.isPreGrabbingWhenSpace) {
      return;
    }

    const viewLocation = new Vector(event.clientX, event.clientY);
    const pressLocation = this.project.renderer.transformView2World(viewLocation);
    for (const entity of this.project.stageManager.getEntities()) {
      // 必须有详细信息才显示详细信息按钮，进而点进去，否则会误触
      if (
        entity.isMouseInDetailsButton(pressLocation) &&
        entity.details.length > 0 &&
        !entity.isHiddenBySectionCollapse
      ) {
        this.project.controllerUtils.editNodeDetails(entity);
        return;
      }
    }

    const detailClickStart = this.detailClickStart;
    this.detailClickStart = undefined;
    const clickedEntity = this.project.stageManager.findEntityByLocation(pressLocation);
    if (
      detailClickStart &&
      clickedEntity === detailClickStart.node &&
      viewLocation.distance(detailClickStart.viewLocation) < 6
    ) {
      this.project.controllerUtils.editNodeDetails(clickedEntity);
      return;
    }

    // 处理引用按钮点击事件
    this.project.referenceManager.onClickReferenceNumber(
      this.project.renderer.transformView2World(MouseLocation.vector()),
    );
  };

  mousemove = (event: MouseEvent) => {
    this.project.controller.resetCountdownTimer();
    const location = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));
    for (const node of this.project.stageManager.getTextNodes()) {
      // KB-managed nodes still need hover state for native details and previews
      // when ordinary node detail labels are configured to stay visible.
      const tracksHover = !Settings.alwaysShowDetails || node.uuid.startsWith("kb:node:");
      node.isMouseHover = tracksHover && node.collisionBox.isContainsPoint(location);
    }
  };

  private editUrlNodeTitle(clickedUrlNode: UrlNode) {
    this.project.controller.isCameraLocked = true;
    // 停止摄像机漂移
    this.project.camera.stopImmediately();
    // 编辑节点
    clickedUrlNode.isEditingTitle = true;
    this.project.inputElement
      .input(
        this.project.renderer
          .transformWorld2View(clickedUrlNode.rectangle.location)
          .add(Vector.same(Renderer.NODE_PADDING).multiply(this.project.camera.currentScale)),
        clickedUrlNode.title,
        (text) => {
          clickedUrlNode?.rename(text);
        },
        {
          fontSize: `${Renderer.FONT_SIZE * this.project.camera.currentScale}px`,
          backgroundColor: "transparent",
          color: this.project.stageStyleManager.currentStyle.StageObjectBorder.toString(),
          outline: "none",
          marginTop: `${-8 * this.project.camera.currentScale}px`,
          width: "100vw",
        },
      )
      .then(() => {
        clickedUrlNode.isEditingTitle = false;
        this.project.controller.isCameraLocked = false;
        this.project.historyManager.recordStep();
      });
  }

  /**
   * 编辑 LaTeX 公式节点（双击时调用）
   * 弹出编辑小窗口
   */
  editLatexNode(node: LatexNode) {
    LatexEditWindow.open(this.project, node);
  }
}
