// eslint-disable-next-line no-restricted-imports
import {Component} from 'react';

import {AreaChart} from 'sentry/components/charts/areaChart';
import ChartZoom from 'sentry/components/charts/chartZoom';
import {HeaderTitleLegend} from 'sentry/components/charts/styles';
import {Panel, PanelBody} from 'sentry/components/panels';
import Placeholder from 'sentry/components/placeholder';
import {t} from 'sentry/locale';
import space from 'sentry/styles/space';
import {ProjectAlertRuleStats} from 'sentry/types/alerts';
import getDynamicText from 'sentry/utils/getDynamicText';
import {
  ChartFooter,
  ChartHeader,
  FooterHeader,
  FooterValue,
  StyledPanelBody,
} from 'sentry/views/alerts/rules/issue/details/alertChart';

type Props = {
  ruleFireHistory: ProjectAlertRuleStats[];
};

type State = Component['state'];

class PreviewChart extends Component<Props, State> {
  renderChart() {
    const {ruleFireHistory} = this.props;

    const series = {
      seriesName: 'Alerts Triggered',
      data: ruleFireHistory.map(alert => ({
        name: alert.date,
        value: alert.count,
      })),
      emphasis: {
        disabled: true,
      },
    };

    return (
      <ChartZoom>
        {zoomRenderProps => (
          <AreaChart
            {...zoomRenderProps}
            isGroupedByDate
            showTimeInTooltip
            grid={{
              left: space(0.25),
              right: space(2),
              top: space(3),
              bottom: 0,
            }}
            yAxis={{
              minInterval: 1,
            }}
            series={[series]}
          />
        )}
      </ChartZoom>
    );
  }

  renderEmpty() {
    return (
      <Panel>
        <PanelBody withPadding>
          <Placeholder height="200px" />
        </PanelBody>
      </Panel>
    );
  }

  render() {
    const {ruleFireHistory} = this.props;
    const totalAlertsTriggered = ruleFireHistory.reduce(
      (acc, curr) => acc + curr.count,
      0
    );

    return (
      <Panel>
        <StyledPanelBody withPadding>
          <ChartHeader>
            <HeaderTitleLegend>{t('Alerts Triggered')}</HeaderTitleLegend>
          </ChartHeader>
          {getDynamicText({
            value: this.renderChart(),
            fixed: <Placeholder height="200px" testId="skeleton-ui" />,
          })}
        </StyledPanelBody>
        <ChartFooter>
          <FooterHeader>{t('Total Alerts')}</FooterHeader>
          <FooterValue>{totalAlertsTriggered.toLocaleString()}</FooterValue>
        </ChartFooter>
      </Panel>
    );
  }
}

export default PreviewChart;
