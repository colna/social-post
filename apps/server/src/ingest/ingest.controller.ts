import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngestService } from './ingest.service';
import { IngestFacebookDto } from './dto/ingest-facebook.dto';

const DEFAULT_TOKEN = 'change-me-ingest-token';

@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingestService: IngestService,
    private readonly config: ConfigService,
  ) {}

  @Post('facebook')
  facebook(
    @Headers('x-ingest-token') token: string | undefined,
    @Body() dto: IngestFacebookDto,
  ) {
    const expected = this.config.get<string>('INGEST_TOKEN') || DEFAULT_TOKEN;
    if (token !== expected) {
      throw new UnauthorizedException('invalid ingest token');
    }
    return this.ingestService.ingestFacebook(dto);
  }
}
