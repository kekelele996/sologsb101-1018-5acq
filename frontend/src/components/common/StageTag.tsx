/**
 * <StageTag> 阶段标签
 * 按胎体状态（待髹涂/髹涂中/待荫干/已完成）与道次状态（待涂/已涂/待打磨/已完成）渲染底色，
 * 并支持荫房异常回写的「待复检」提示；被胎体页、道次页、打磨页消费。
 */
import { Tag, Tooltip } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { BODY_STATE_COLOR, BODY_STATE_LABEL, type BodyState } from '@/types/body';
import { COAT_STATE_COLOR, COAT_STATE_LABEL, type CoatState } from '@/types/coat';

export type StageKey = BodyState | CoatState;

export interface StageTagProps {
  /** 状态键：胎体状态或道次状态 */
  state: StageKey;
  /** 是否需要复检（荫房温湿度越界后回写） */
  needRecheck?: boolean;
  /** 道次序号，传入时前缀显示「第 n 道」 */
  seq?: number;
  /** 追加文案，如「已完成 2/4」 */
  suffix?: string;
}

const LABEL: Record<string, string> = { ...BODY_STATE_LABEL, ...COAT_STATE_LABEL };
const COLOR: Record<string, string> = { ...BODY_STATE_COLOR, ...COAT_STATE_COLOR };

export function StageTag({ state, needRecheck = false, seq, suffix }: StageTagProps) {
  const label = LABEL[state] ?? state;
  const color = COLOR[state] ?? '#8c8c8c';
  const text = `${seq === undefined ? '' : `第 ${seq} 道 · `}${label}${suffix ? ` · ${suffix}` : ''}`;

  return (
    <>
      <Tag color={color} style={{ marginInlineEnd: needRecheck ? 4 : 0 }}>
        {text}
      </Tag>
      {needRecheck ? (
        <Tooltip title="关联荫房温湿度越界，需复检漆层">
          <Tag icon={<ExclamationCircleOutlined />} color="warning">
            待复检
          </Tag>
        </Tooltip>
      ) : null}
    </>
  );
}

export default StageTag;
