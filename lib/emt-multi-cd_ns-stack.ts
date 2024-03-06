import * as cdk from 'aws-cdk-lib';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { MediaTailorWithCloudFront, CloudFront } from 'awscdk-mediatailor-cloudfront-construct';

function getFileName(url: string): string {
  if (url.endsWith('.m3u8') || url.endsWith('.mpd')) {
    return url.split('/').pop() || url;
  }
  return '';
}

export class EmtMultiCdNsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /*
    const videoContentSourceUrl = new cdk.CfnParameter(this, "contentSourceUrl", {
      type: "String",
      description: "The URL of the MediaTailor HLS endpoint used by MediaTailor as the content origin."
    }).valueAsString;

    const adDecisionServerUrl = new cdk.CfnParameter(this, "adDecisionServerUrl", {
      type: "String",
      description: "The URL of the ad server used by MediaTailor as the ADS."
    }).valueAsString;

    const slateAdUrl = new cdk.CfnParameter(this, "slateAdUrl", {
      type: "String",
      description: "The URL of the video file used by MediaTailor as the slate."
    }).valueAsString;
    */

    const videoContentSourceUrl = 'https://xxx.mediapackage.ap-northeast-1.amazonaws.com/out/v1/yyy/index.m3u8';

    const adDecisionServerUrl = 'https://my-ad-server/vast';

    const slateAdUrl = 'https://my-bucket.s3.amazonaws.com/slate.mp4';

    // Create MediaTailor with CloudFront
    const {cf, emt} = new MediaTailorWithCloudFront(this, 'MediaTailorWithCloudFront', {
      videoContentSourceUrl,
      adDecisionServerUrl,
      slateAdUrl,
    });

    const innerCfDomainName = cf.distribution.distributionDomainName;
    const contentPath = cdk.Fn.select(1, cdk.Fn.split('/out/', emt.config.videoContentSourceUrl));
    const mediaTailorHlsPath = cdk.Fn.select(1, cdk.Fn.split('/v1/', emt.config.attrHlsConfigurationManifestEndpointPrefix));

    // Create another CloudFront
    const outerCf = new CloudFront(this, 'CloudFront', {
      videoContentSourceUrl: `https://${innerCfDomainName}/out/${contentPath}`,
      mediaTailorEndpointUrl: `https://${innerCfDomainName}/v1/${mediaTailorHlsPath}`,
      adSegmentSourceUrl: `https://${innerCfDomainName}/tm`,
    });

    const outerCfDomainName = outerCf.distribution.distributionDomainName;

    // Create a Custom Resource to update MediaTailor's CDN configuration with the OuterCloudFront
    new AwsCustomResource(this, 'AssociateMediaTailorWithCloudFront', {
      onCreate: {
        service: 'MediaTailor',
        action: 'PutPlaybackConfiguration',
        region: cdk.Aws.REGION,
        parameters: {
          Name: emt.config.name,
          VideoContentSourceUrl: emt.config.videoContentSourceUrl,
          AdDecisionServerUrl: emt.config.adDecisionServerUrl,
          SlateAdUrl: emt.config.slateAdUrl,
          CdnConfiguration: {
            AdSegmentUrlPrefix: `https://${outerCfDomainName}`,
            ContentSegmentUrlPrefix: `https://${outerCfDomainName}/out/${contentPath}`,
          },
        },
        physicalResourceId: PhysicalResourceId.of(Date.now().toString()),
      },
      //Will ignore any resource and use the assumedRoleArn as resource and 'sts:AssumeRole' for service:action
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const hlsPlaybackUrl =`https://${outerCfDomainName}/v1/${mediaTailorHlsPath}${getFileName(videoContentSourceUrl)}`;

    // Output MediaTile HLS playback URL via CloudFront
    new cdk.CfnOutput(this, "HLSPlaybackPrefix", {
      value: hlsPlaybackUrl,
      exportName: cdk.Aws.STACK_NAME + "HLSPlaybackUrl",
      description: "The HLS playback UR via CloudFront",
    });

    // Output MediaTailor Session Initialization Prefix
    new cdk.CfnOutput(this, "SessionInitializationPrefix", {
      value: emt.config.attrSessionInitializationEndpointPrefix || '',
      exportName: cdk.Aws.STACK_NAME + "SessionInitializationPrefix",
      description: "The session initialization prefix for MediaTailor Configuration",
    });
  }
}
